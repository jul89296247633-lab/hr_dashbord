import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { dateStringSchema } from '@/lib/validations';

type Trend = 'up' | 'down' | 'flat';

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90 };

/**
 * GET /api/stats/politeness — индекс вежливости компании и менеджеров за период.
 * Источник: hh_manager_stats. Query: date=YYYY-MM-DD (конкретная) или period=week|month|quarter (default month=30 дней).
 * head/admin — все; manager — только свой ряд (RLS) + ИВ компании.
 *
 * ИВ компании теперь считается на лету как **weighted average** по менеджерам
 * (вес = responses_received). HH перестал выгружать отдельный CSV с ИВ компании,
 * поэтому source_csv='politeness_company' больше не пишется через
 * /api/sync/hh-csv. Если в БД остались исторические строки company —
 * учитываем их как fallback (для совместимости).
 *
 * avg_response_hours в новом отчёте HH отсутствует — поле остаётся в БД
 * nullable, но из UI убрано (не отдаём в company-агрегате).
 */
export async function GET(request: NextRequest) {
  try {
    await getAuthUser();

    const sp = request.nextUrl.searchParams;
    const dateParam = sp.get('date');
    let from: string;
    let to: string;
    if (dateParam) {
      if (!dateStringSchema.safeParse(dateParam).success) {
        return apiError('VALIDATION_ERROR', 'date: формат YYYY-MM-DD', 422);
      }
      from = dateParam;
      to = dateParam;
    } else {
      const days = PERIOD_DAYS[sp.get('period') ?? 'month'] ?? 30;
      to = new Date().toISOString().slice(0, 10);
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
      from = fromDate.toISOString().slice(0, 10);
    }

    const supabase = await createClient();

    // ── По менеджерам (источник истины для всего ответа) ─────────────────────
    const { data: rows, error: rowsError } = await supabase
      .from('hh_manager_stats')
      .select(
        'manager_id, stat_date, source_csv, politeness_index, hh_calls_count, responses_received, responses_viewed, responses_answered, avg_response_hours, manager:user_profiles!hh_manager_stats_manager_id_fkey(id, full_name)',
      )
      .not('manager_id', 'is', null)
      .gte('stat_date', from)
      .lte('stat_date', to)
      .order('stat_date', { ascending: false });
    if (rowsError) throw new ApiError(500, 'DB_ERROR', rowsError.message);

    // Группировка по менеджеру: последний politeness + предыдущий (для тренда).
    const byManager = new Map<
      string,
      {
        full_name: string;
        politenessHistory: (number | null)[];
        latestPoliteness: (typeof rows)[number] | null;
        latestCalls: number | null;
      }
    >();

    for (const r of rows ?? []) {
      if (!r.manager_id) continue;
      const entry =
        byManager.get(r.manager_id) ??
        { full_name: r.manager?.full_name ?? '—', politenessHistory: [], latestPoliteness: null, latestCalls: null };

      if (r.source_csv === 'politeness_managers') {
        entry.politenessHistory.push(r.politeness_index);
        if (!entry.latestPoliteness) entry.latestPoliteness = r;
      }
      // Исторический source_csv='calls' (устаревший) — оставляем чтение для
      // совместимости со старыми записями.
      if (r.source_csv === 'calls' && entry.latestCalls === null) {
        entry.latestCalls = r.hh_calls_count;
      }
      byManager.set(r.manager_id, entry);
    }

    const managers = Array.from(byManager.entries()).map(([managerId, e]) => ({
      manager_id: managerId,
      full_name: e.full_name,
      politeness_index: e.latestPoliteness?.politeness_index ?? null,
      hh_calls_count: e.latestCalls ?? e.latestPoliteness?.hh_calls_count ?? null,
      responses_received: e.latestPoliteness?.responses_received ?? null,
      responses_viewed: e.latestPoliteness?.responses_viewed ?? null,
      responses_answered: e.latestPoliteness?.responses_answered ?? null,
      trend: trendOf(e.politenessHistory[0] ?? null, e.politenessHistory[1] ?? null),
    }));

    // ── Индекс компании = weighted average (вес = responses_received) ────────
    // Берём только менеджеров с непустым politeness_index. Если ни у кого нет
    // откликов (все веса = 0) — fallback на простое среднее.
    let companyPoliteness: number | null = null;
    let companyResponses = 0;
    let companyViewed = 0;
    let companyAnswered = 0;

    const weighted: { pi: number; w: number }[] = [];
    for (const m of managers) {
      if (m.politeness_index === null) continue;
      const w = m.responses_received ?? 0;
      weighted.push({ pi: m.politeness_index, w });
      companyResponses += m.responses_received ?? 0;
      companyViewed += m.responses_viewed ?? 0;
      companyAnswered += m.responses_answered ?? 0;
    }
    if (weighted.length > 0) {
      const totalWeight = weighted.reduce((s, x) => s + x.w, 0);
      if (totalWeight > 0) {
        companyPoliteness = weighted.reduce((s, x) => s + x.pi * x.w, 0) / totalWeight;
      } else {
        companyPoliteness = weighted.reduce((s, x) => s + x.pi, 0) / weighted.length;
      }
    }

    const company = companyPoliteness !== null
      ? {
          politeness_index: Math.round(companyPoliteness * 10) / 10,
          responses_received: companyResponses,
          responses_viewed: companyViewed,
          responses_answered: companyAnswered,
          // avg_response_hours убран: новый отчёт HH этой колонки не отдаёт.
          last_updated: to,
        }
      : null;

    return apiSuccess({
      data: { period: `${from} — ${to}`, company, managers },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Тренд: текущее значение против предыдущего. */
function trendOf(latest: number | null, prev: number | null): Trend {
  if (latest === null || prev === null) return 'flat';
  if (latest > prev) return 'up';
  if (latest < prev) return 'down';
  return 'flat';
}
