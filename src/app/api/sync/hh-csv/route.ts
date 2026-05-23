import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { hhCsvTypeSchema, dateStringSchema } from '@/lib/validations';
import {
  decodeWin1251,
  parseCsv,
  hasExpectedColumns,
  normalizeName,
  parseNumber,
  type HHReportType,
} from '@/lib/hh-csv-parser';

// query type → hh_manager_stats.source_csv
const SOURCE_BY_TYPE: Record<'calls' | 'politeness' | 'company_politeness', HHReportType> = {
  calls: 'calls',
  politeness: 'politeness_managers',
  company_politeness: 'politeness_company',
};

// Лимит размера CSV (защита от DoS): 10 MiB. Превышение → 413 FILE_TOO_LARGE.
const MAX_CSV_BYTES = 10 * 1024 * 1024;

interface FuzzyMatch {
  hh_name: string;
  matched_to: string;
  score: number;
}

/**
 * POST /api/sync/hh-csv — загрузка CSV «Аналитика подбора» HH (head, admin).
 * multipart/form-data: file (windows-1251). Query: type, stat_date?.
 *
 * Сопоставляет менеджеров ТОЛЬКО со списком hr_manager_syncs (CLAUDE.md правило №8):
 * чужие имена молча пропускаются. Запись — service-role.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const typeParsed = hhCsvTypeSchema.safeParse(request.nextUrl.searchParams.get('type') ?? undefined);
    if (!typeParsed.success) {
      return apiError('VALIDATION_ERROR', 'type: calls | politeness | company_politeness', 422);
    }
    const reportType = SOURCE_BY_TYPE[typeParsed.data];

    const statDateRaw = request.nextUrl.searchParams.get('stat_date') ?? new Date().toISOString().slice(0, 10);
    if (!dateStringSchema.safeParse(statDateRaw).success) {
      return apiError('VALIDATION_ERROR', 'stat_date: формат YYYY-MM-DD', 422);
    }
    const statDate = statDateRaw;

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return apiError('VALIDATION_ERROR', 'Не передан файл (поле "file")', 422);
    }
    if (file.size > MAX_CSV_BYTES) {
      return apiError(
        'FILE_TOO_LARGE',
        `Файл больше ${MAX_CSV_BYTES / 1024 / 1024} МБ. Сократите выборку и загрузите снова.`,
        413,
      );
    }

    const text = decodeWin1251(Buffer.from(await file.arrayBuffer()));
    const { headers, rows } = parseCsv(text);
    if (!hasExpectedColumns(headers, reportType)) {
      return apiError(
        'INVALID_CSV_FORMAT',
        `Файл не соответствует формату отчёта '${typeParsed.data}'`,
        422,
      );
    }

    const db = createAdminClient();

    // ── Индекс вежливости компании: одна строка, manager_id=NULL ──────────────
    if (reportType === 'politeness_company') {
      const row = rows[0] ?? {};
      await db
        .from('hh_manager_stats')
        .delete()
        .is('manager_id', null)
        .eq('stat_date', statDate)
        .eq('source_csv', 'politeness_company');
      await db.from('hh_manager_stats').insert({
        manager_id: null,
        stat_date: statDate,
        politeness_index: parseNumber(getCol(row, 'Индекс вежливости')),
        responses_received: parseNumber(getCol(row, 'Получено откликов')),
        responses_viewed: parseNumber(getCol(row, 'Отмечено просмотренными')),
        responses_answered: parseNumber(getCol(row, 'Отправлено ответов')),
        source_csv: 'politeness_company',
      });
      await logSync(db, user.id, 1, 1, 'ok');
      return apiSuccess({
        data: { report_type: reportType, stat_date: statDate, rows_parsed: rows.length, rows_matched: 1 },
      });
    }

    // ── Менеджеры: матчим только «наших» (hr_manager_syncs) ──────────────────
    const { data: syncs } = await db
      .from('hr_manager_syncs')
      .select('sheet_full_name, user_profile_id');
    // Только сопоставленные с user_profiles (нужен реальный manager_id для FK).
    const linked = (syncs ?? []).filter((s) => s.user_profile_id);
    const exactMap = new Map(linked.map((s) => [normalizeName(s.sheet_full_name), s]));

    let matchedExact = 0;
    let matchedFuzzy = 0;
    const fuzzyMatches: FuzzyMatch[] = [];
    const skippedNames: string[] = [];

    for (const row of rows) {
      const hhName = getCol(row, 'Менеджер');
      if (!hhName) continue;
      const norm = normalizeName(hhName);

      let sync = exactMap.get(norm);
      let isFuzzy = false;
      if (!sync) {
        const fuzzy = fuzzyManager(norm, linked);
        if (fuzzy) {
          sync = fuzzy.sync;
          isFuzzy = true;
          fuzzyMatches.push({ hh_name: hhName, matched_to: fuzzy.sync.sheet_full_name, score: fuzzy.score });
        }
      }
      if (!sync || !sync.user_profile_id) {
        skippedNames.push(hhName);
        continue;
      }

      if (isFuzzy) matchedFuzzy += 1;
      else matchedExact += 1;

      if (reportType === 'calls') {
        const calls = parseNumber(getCol(row, 'Количество звонков')) ?? 0;
        await db.from('hh_manager_stats').upsert(
          {
            manager_id: sync.user_profile_id,
            manager_name_hh: hhName,
            stat_date: statDate,
            hh_calls_count: calls,
            source_csv: 'calls',
          },
          { onConflict: 'manager_id,stat_date,source_csv' },
        );
        // Также проставляем hh_calls_count в активность дня (источник 'hh_csv').
        await db.from('daily_activities').upsert(
          {
            manager_id: sync.user_profile_id,
            activity_date: statDate,
            hh_calls_count: calls,
            hh_calls_source: 'hh_csv',
          },
          { onConflict: 'manager_id,activity_date' },
        );
      } else {
        // politeness_managers
        await db.from('hh_manager_stats').upsert(
          {
            manager_id: sync.user_profile_id,
            manager_name_hh: hhName,
            stat_date: statDate,
            politeness_index: parseNumber(getCol(row, 'Индекс вежливости')),
            responses_received: parseNumber(getCol(row, 'Получено откликов')),
            responses_viewed: parseNumber(getCol(row, 'Отмечено просмотренными')),
            responses_answered: parseNumber(getCol(row, 'Отправлено ответов')),
            avg_response_hours: parseNumber(getCol(row, 'Среднее время ответа')),
            source_csv: 'politeness_managers',
          },
          { onConflict: 'manager_id,stat_date,source_csv' },
        );
      }
    }

    const matched = matchedExact + matchedFuzzy;
    await logSync(db, user.id, rows.length, matched, 'ok');

    return apiSuccess({
      data: {
        report_type: reportType,
        stat_date: statDate,
        rows_parsed: rows.length,
        rows_matched: matched,
        rows_matched_exact: matchedExact,
        rows_matched_fuzzy: matchedFuzzy,
        fuzzy_matches: fuzzyMatches,
        rows_skipped: skippedNames.length,
        skipped_names: skippedNames,
        skip_reason: "Не найдены в листе 'HR менеджеры' Google Sheets — не наши менеджеры",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Чтение колонки без учёта регистра/частичного совпадения заголовка. */
function getCol(row: Record<string, string>, name: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase().includes(name.toLowerCase()));
  return key ? row[key] : '';
}

/**
 * Лёгкое сопоставление ФИО без выделенной RPC: совпадение по фамилии (первый токен),
 * если кандидат единственный. Заглушечный score. (Полноценный fuzzy потребует RPC по
 * именам — fuzzy_match_vacancy предназначен для названий вакансий, не для имён.)
 */
function fuzzyManager(
  normHhName: string,
  linked: { sheet_full_name: string; user_profile_id: string | null }[],
): { sync: { sheet_full_name: string; user_profile_id: string | null }; score: number } | null {
  const surname = normHhName.split(' ')[0];
  if (!surname || surname.length < 3) return null;
  const candidates = linked.filter((s) => normalizeName(s.sheet_full_name).startsWith(surname));
  if (candidates.length === 1) return { sync: candidates[0], score: 0.8 };
  return null;
}

async function logSync(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  total: number,
  updated: number,
  status: 'ok' | 'error',
): Promise<void> {
  await db.from('sync_logs').insert({
    source: 'hh_csv',
    status,
    records_total: total,
    records_updated: updated,
    triggered_by: userId,
    finished_at: new Date().toISOString(),
  });
}
