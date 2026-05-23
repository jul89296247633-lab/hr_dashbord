import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { bonusesSummaryPeriodSchema } from '@/lib/validations';

/**
 * GET /api/bonuses/summary — сводка бонусов по менеджерам за период
 * (week|month|quarter|year). manager — только свой ряд; head/admin — все.
 *
 * Источник — RPC compute_manager_bonuses (SPEC §5.3 / §5.6):
 * бонус считается на лету как тариф из bonus_rates, fuzzy-совпавший
 * с hired_employees.position_name. Статусов pending/paid в новой модели нет
 * (см. историю: до 20260523180000_bonus_rates).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const periodParsed = bonusesSummaryPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const { from, to } = periodRange(periodParsed.data);

    const effectiveManagerId = user.role === 'manager' ? user.id : null;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('compute_manager_bonuses', {
      p_from: from,
      p_to: to,
      p_manager_id: effectiveManagerId,
    });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    type RpcRow = {
      manager_id: string | null;
      manager_name: string | null;
      hired_date: string;
      amount_kopecks: number | null;
    };

    const byManager = new Map<
      string,
      { full_name: string; count: number; total: number; lastDate: string | null }
    >();
    for (const r of (data as RpcRow[] | null) ?? []) {
      if (!r.manager_id) continue;
      const entry =
        byManager.get(r.manager_id) ??
        { full_name: r.manager_name ?? '—', count: 0, total: 0, lastDate: null };
      entry.count += 1;
      entry.total += r.amount_kopecks ?? 0;
      if (!entry.lastDate || r.hired_date > entry.lastDate) entry.lastDate = r.hired_date;
      byManager.set(r.manager_id, entry);
    }

    const summary = Array.from(byManager.entries()).map(([managerId, e]) => ({
      manager_id: managerId,
      full_name: e.full_name,
      bonuses_count: e.count,
      total_kopecks: e.total,
      total_display: formatKopecks(e.total),
      last_bonus_date: e.lastDate,
    }));

    return apiSuccess({ data: summary });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Копейки → «250 000 ₽». */
function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')} ₽`;
}

/** Диапазон периода [from, to=сегодня]. */
function periodRange(period: 'week' | 'month' | 'quarter' | 'year'): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (period === 'week') {
    const offset = (today.getDay() + 6) % 7;
    start.setDate(today.getDate() - offset);
  } else if (period === 'month') {
    start.setMonth(today.getMonth(), 1);
  } else if (period === 'quarter') {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(qStartMonth, 1);
  } else {
    start.setMonth(0, 1);
  }
  return { from: start.toISOString().slice(0, 10), to };
}
