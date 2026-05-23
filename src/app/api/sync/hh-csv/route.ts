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
  decodeCsv,
  parseCsv,
  hasExpectedColumns,
  normalizeName,
  parseNumber,
  parsePercent,
  parseBoolYesNo,
} from '@/lib/hh-csv-parser';

// Лимит размера CSV (защита от DoS): 10 MiB. Превышение → 413 FILE_TOO_LARGE.
const MAX_CSV_BYTES = 10 * 1024 * 1024;

// ── Колонки CSV (центральная точка истины маппинга) ───────────────────────────
// recruitment_analytics_managers_statistics_*.csv (UTF-8 BOM, разделитель ';')
//   ├ "Менеджер"                          → hh_manager_stats.manager_name_hh
//   ├ "id менеджера"                      → справочно (не используется — матчим по ФИО)
//   ├ "Индекс вежливости"                 → politeness_index (parsePercent: "97%" → 97)
//   ├ "Отклики, шт."                      → responses_received
//   ├ "Просмотры резюме из отклика, шт."  → responses_viewed
//   └ "Приглашений из откликов, шт."      → responses_answered
//   Среднее время ответа в новом отчёте HH отсутствует → avg_response_hours = NULL.
//
// recruitment_analytics_vacancies_*.csv (UTF-8 BOM, разделитель ';')
//   ├ "id вакансии"                       → vacancies.hh_vacancy_id
//   ├ "Архивная"                          → "Да"/"Нет" (EC-03: Да → status='closed')
//   ├ "Фактическая дата архивации"        → vacancies.closed_at (формат DD.MM.YYYY)
//   ├ "Показы"                            → vacancy_snapshots.views_count
//   ├ "Просмотры"                         → справочно
//   ├ "Отклики"                           → vacancy_snapshots.responses_count
//   ├ "Приглашения из откликов"           → vacancy_snapshots.invitations_sent
//   └ "Просмотры резюме из отклика"       → vacancy_snapshots.contacts_opened
//                                           (SPEC: «контакты, открытые менеджером»)

interface FuzzyMatch {
  hh_name: string;
  matched_to: string;
  score: number;
}

/**
 * POST /api/sync/hh-csv — загрузка аналитических CSV из HH (head, admin).
 * multipart/form-data: file (UTF-8 BOM). Query: type, stat_date?.
 *
 * type='politeness' — сопоставляет менеджеров со списком hr_manager_syncs
 *   (CLAUDE.md §8): чужие имена молча пропускаются.
 * type='vacancies' — сопоставляет вакансии по hh_vacancy_id; вакансии не из
 *   нашего списка молча пропускаются.
 *
 * Запись — service-role (минует RLS).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const typeParsed = hhCsvTypeSchema.safeParse(request.nextUrl.searchParams.get('type') ?? undefined);
    if (!typeParsed.success) {
      return apiError('VALIDATION_ERROR', 'type: politeness_managers | vacancies', 422);
    }
    const reportType = typeParsed.data;

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

    const text = decodeCsv(Buffer.from(await file.arrayBuffer()));
    const { headers, rows } = parseCsv(text);
    if (!hasExpectedColumns(headers, reportType)) {
      return apiError(
        'INVALID_CSV_FORMAT',
        `Файл не соответствует формату отчёта '${typeParsed.data}'`,
        422,
      );
    }

    const db = createAdminClient();

    // ── type=vacancies → vacancy_snapshots + EC-03 (auto-close) ───────────────
    if (reportType === 'vacancies') {
      // Загружаем карту наших вакансий по hh_vacancy_id (только активные/на паузе/draft;
      // уже закрытые не апдейтим повторно).
      const { data: ourVacancies } = await db
        .from('vacancies')
        .select('id, hh_vacancy_id, status')
        .not('hh_vacancy_id', 'is', null);
      const vacancyByHhId = new Map(
        (ourVacancies ?? []).map((v) => [String(v.hh_vacancy_id), { id: v.id, status: v.status }]),
      );

      let matched = 0;
      let closed = 0;
      const skipped: string[] = [];

      // Границы дня для DELETE-перед-INSERT (см. ниже).
      const dayStart = `${statDate}T00:00:00Z`;
      const dayEnd = `${addDays(statDate, 1)}T00:00:00Z`;

      for (const row of rows) {
        const hhId = getCol(row, 'id вакансии');
        if (!hhId) continue;
        const ours = vacancyByHhId.get(hhId);
        if (!ours) {
          skipped.push(hhId);
          continue;
        }

        // Идемпотентность: одна запись snapshot за день на вакансию.
        // DB-уровневого UNIQUE-индекса нет (см. миграцию 20260523140000_*),
        // уникальность держим здесь — DELETE-за-день + INSERT
        // (повторная загрузка CSV за тот же день перетирает старое).
        await db
          .from('vacancy_snapshots')
          .delete()
          .eq('vacancy_id', ours.id)
          .gte('snapshot_at', dayStart)
          .lt('snapshot_at', dayEnd);

        await db.from('vacancy_snapshots').insert({
          vacancy_id: ours.id,
          snapshot_at: dayStart,
          views_count: parseNumber(getCol(row, 'Показы')) ?? 0,
          responses_count: parseNumber(getCol(row, 'Отклики')) ?? 0,
          // SPEC: «контакты, открытые менеджером» = просмотры резюме откликнувшихся.
          contacts_opened: parseNumber(getCol(row, 'Просмотры резюме из отклика')) ?? 0,
          invitations_sent: parseNumber(getCol(row, 'Приглашения из откликов')) ?? 0,
          source: 'hh_csv',
        });
        matched += 1;

        // EC-03: если HH пометил вакансию архивной — закрываем у себя.
        // Используем «Фактическую дату архивации» если задана, иначе stat_date.
        if (parseBoolYesNo(getCol(row, 'Архивная')) && ours.status !== 'closed') {
          const closedAt = parseRuDate(getCol(row, 'Фактическая дата архивации')) ?? statDate;
          await db
            .from('vacancies')
            .update({ status: 'closed', closed_at: closedAt })
            .eq('id', ours.id);
          closed += 1;
        }
      }

      await logSync(db, user.id, rows.length, matched, 'ok');
      return apiSuccess({
        data: {
          report_type: reportType,
          stat_date: statDate,
          rows_parsed: rows.length,
          rows_matched: matched,
          rows_closed: closed,
          rows_skipped: skipped.length,
          skipped_hh_ids: skipped.slice(0, 50),
          skip_reason: 'hh_vacancy_id не найден в наших вакансиях',
        },
      });
    }

    // ── type=politeness_managers → hh_manager_stats ───────────────────────────
    // Приоритет матчинга:
    //   1) hh_manager_id (точный, стабильный — id из HH)
    //   2) exact normalize по ФИО (legacy, для записей где hh_manager_id ещё пуст)
    //   3) fuzzy по фамилии (для опечаток / двойных имён)
    // После успешного матча по ФИО — обогащаем hr_manager_syncs новым
    // hh_manager_id, чтобы следующий раз сразу шла ветка (1).
    const { data: syncs } = await db
      .from('hr_manager_syncs')
      .select('id, sheet_full_name, user_profile_id, hh_manager_id');
    const linked = (syncs ?? []).filter((s) => s.user_profile_id);
    const byHhId = new Map(
      linked.filter((s) => s.hh_manager_id).map((s) => [String(s.hh_manager_id), s]),
    );
    const exactMap = new Map(linked.map((s) => [normalizeName(s.sheet_full_name), s]));

    let matchedById = 0;
    let matchedExact = 0;
    let matchedFuzzy = 0;
    const fuzzyMatches: FuzzyMatch[] = [];
    const skippedNames: string[] = [];

    for (const row of rows) {
      const hhName = getCol(row, 'Менеджер');
      if (!hhName) continue;
      const hhManagerId = getCol(row, 'id менеджера').trim() || null;
      const norm = normalizeName(hhName);

      // (1) Приоритет: по hh_manager_id.
      let sync = hhManagerId ? byHhId.get(hhManagerId) : undefined;
      let matchedVia: 'id' | 'exact' | 'fuzzy' | null = sync ? 'id' : null;

      // (2) По нормализованному ФИО.
      if (!sync) {
        sync = exactMap.get(norm);
        if (sync) matchedVia = 'exact';
      }

      // (3) Fuzzy по фамилии.
      if (!sync) {
        const fuzzy = fuzzyManager(norm, linked);
        if (fuzzy) {
          sync = fuzzy.sync;
          matchedVia = 'fuzzy';
          fuzzyMatches.push({ hh_name: hhName, matched_to: fuzzy.sync.sheet_full_name, score: fuzzy.score });
        }
      }

      if (!sync || !sync.user_profile_id) {
        skippedNames.push(hhName);
        continue;
      }

      if (matchedVia === 'id') matchedById += 1;
      else if (matchedVia === 'exact') matchedExact += 1;
      else if (matchedVia === 'fuzzy') matchedFuzzy += 1;

      // Обогащение: если у записи нет hh_manager_id, а из CSV пришёл —
      // прописываем (один раз, дальше пойдём по ветке (1)).
      if (hhManagerId && !sync.hh_manager_id) {
        await db
          .from('hr_manager_syncs')
          .update({ hh_manager_id: hhManagerId })
          .eq('id', sync.id);
        // Локально тоже фиксируем, чтобы следующая строка с тем же id видела матч.
        sync.hh_manager_id = hhManagerId;
        byHhId.set(hhManagerId, sync);
      }

      await db.from('hh_manager_stats').upsert(
        {
          manager_id: sync.user_profile_id,
          manager_name_hh: hhName,
          stat_date: statDate,
          politeness_index: parsePercent(getCol(row, 'Индекс вежливости')),
          responses_received: parseNumber(getCol(row, 'Отклики')),
          responses_viewed: parseNumber(getCol(row, 'Просмотры резюме из отклика')),
          responses_answered: parseNumber(getCol(row, 'Приглашений из откликов')),
          // avg_response_hours: новый отчёт HH этой колонки не отдаёт → NULL.
          avg_response_hours: null,
          source_csv: 'politeness_managers',
        },
        { onConflict: 'manager_id,stat_date,source_csv' },
      );
    }

    const matched = matchedById + matchedExact + matchedFuzzy;
    await logSync(db, user.id, rows.length, matched, 'ok');

    return apiSuccess({
      data: {
        report_type: reportType,
        stat_date: statDate,
        rows_parsed: rows.length,
        rows_matched: matched,
        rows_matched_by_id: matchedById,
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

/** YYYY-MM-DD + N дней → YYYY-MM-DD. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Дата HH в формате DD.MM.YYYY → ISO YYYY-MM-DD (или null при пустом/`-`). */
function parseRuDate(value: string): string | null {
  const v = (value ?? '').trim();
  if (!v || v === '-') return null;
  const m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Лёгкое сопоставление ФИО без выделенной RPC: совпадение по фамилии (первый токен),
 * если кандидат единственный. Дженерик по форме записи sync —
 * чтобы возвращался тот же объект, который пришёл (с id, hh_manager_id и т. п.).
 */
function fuzzyManager<T extends { sheet_full_name: string; user_profile_id: string | null }>(
  normHhName: string,
  linked: T[],
): { sync: T; score: number } | null {
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
