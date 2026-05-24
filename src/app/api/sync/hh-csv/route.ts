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
import { provisionManager } from '@/lib/auto-provision';

// Лимит размера CSV (защита от DoS): 10 MiB. Превышение → 413 FILE_TOO_LARGE.
const MAX_CSV_BYTES = 10 * 1024 * 1024;

// ── Колонки CSV (центральная точка истины маппинга) ───────────────────────────
// recruitment_analytics_managers_statistics_*.csv (UTF-8 BOM, разделитель ';')
//   ├ "Менеджер"                            → hh_manager_stats.manager_name_hh
//   ├ "id менеджера"                        → справочно (матчинг через ФИО + hh_manager_id)
//   ├ "Индекс вежливости"                   → politeness_index (parsePercent: "97%" → 97)
//   ├ "Отклики, шт."                        → responses_received
//   ├ "Просмотры резюме из отклика, шт."    → responses_viewed (БЕСПЛАТНО)
//   ├ "Приглашений из откликов, шт."        → responses_answered
//   ├ "Просмотры резюме из поиска, шт." ⓟ   → resume_views_from_search (ПЛАТНО)
//   └ "Приглашений из базы резюме, шт." ⓟ   → invitations_from_db (ПЛАТНО)
//   ⓟ — платные действия (менеджер сам ищет в базе HH). Старые CSV эти
//   колонки не отдают → пишем NULL и не падаем.
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
      // Карта вакансий по hh_vacancy_id (всех статусов — нужно знать, что у
      // нас уже было). Если в CSV приходит hh_vacancy_id, которого нет — мы
      // авто-создадим вакансию по данным CSV (title/location/status/manager).
      const { data: ourVacancies } = await db
        .from('vacancies')
        .select('id, hh_vacancy_id, status')
        .not('hh_vacancy_id', 'is', null);
      const vacancyByHhId = new Map(
        (ourVacancies ?? []).map((v) => [String(v.hh_vacancy_id), { id: v.id, status: v.status }]),
      );

      // user_profiles для матчинга «Менеджеры» из CSV → manager_id.
      // Используем нормализованное ФИО (lower, ё→е, схлопывание пробелов) +
      // вариант «Фамилия Имя» (HH часто отдаёт ФИО с отчеством).
      const { data: profiles } = await db
        .from('user_profiles')
        .select('id, full_name');
      const profileByNormName = new Map(
        (profiles ?? []).map((p) => [normalizeName(p.full_name), p.id]),
      );
      const profileByFirstTwo = new Map<string, string>();
      for (const p of profiles ?? []) {
        const k = firstTwoWords(normalizeName(p.full_name));
        // Только первое попадание — однофамильцы с одинаковым именем
        // не сматчатся однозначно (оставляем undefined для них).
        if (!profileByFirstTwo.has(k)) profileByFirstTwo.set(k, p.id);
      }

      let matched = 0;
      let closed = 0;
      let createdVacancies = 0;
      let createdUsers = 0;
      const skipped: string[] = [];

      // Границы дня для DELETE-перед-INSERT (см. ниже).
      const dayStart = `${statDate}T00:00:00Z`;
      const dayEnd = `${addDays(statDate, 1)}T00:00:00Z`;

      for (const row of rows) {
        const hhId = getCol(row, 'id вакансии');
        if (!hhId) continue;
        let ours = vacancyByHhId.get(hhId);

        // Авто-создание вакансии, если её ещё нет в БД.
        // Источник данных — сам CSV (title / location / manager / status).
        if (!ours) {
          const title = getColFirst(row, 'Название вакансии', 'Название').trim();
          const location = getColFirst(row, 'Населённый пункт', 'Населенный пункт', 'Город').trim() || null;
          const managersRaw = getCol(row, 'Менеджеры');
          const firstManager = (managersRaw.split(/[,;]/)[0] ?? '').trim();
          const isClosed =
            parseBoolYesNo(getCol(row, 'Архивная')) ||
            parseBoolYesNo(getCol(row, 'Закрытая'));
          const closedAt = parseRuDate(getCol(row, 'Фактическая дата архивации'));
          const openedAt = parseRuDate(getCol(row, 'Дата создания')) ?? statDate;

          if (title.length < 2 || !firstManager) {
            skipped.push(hhId);
            continue;
          }

          // Матчинг менеджера: exact normalize → «Фамилия Имя» → авто-создать.
          const norm = normalizeName(firstManager);
          let managerId =
            profileByNormName.get(norm) ?? profileByFirstTwo.get(firstTwoWords(norm)) ?? null;
          if (!managerId) {
            const result = await provisionManager(db, firstManager);
            if (result.userProfileId) {
              managerId = result.userProfileId;
              if (result.created) createdUsers += 1;
              profileByNormName.set(norm, managerId);
              profileByFirstTwo.set(firstTwoWords(norm), managerId);
            }
          }
          if (!managerId) {
            skipped.push(hhId);
            continue;
          }

          const { data: inserted, error: insertErr } = await db
            .from('vacancies')
            .insert({
              hh_vacancy_id: hhId,
              title,
              location,
              manager_id: managerId,
              status: isClosed ? 'closed' : 'active',
              opened_at: openedAt,
              closed_at: isClosed ? (closedAt ?? statDate) : null,
            })
            .select('id, status')
            .single();
          if (insertErr || !inserted) {
            skipped.push(hhId);
            continue;
          }
          ours = { id: inserted.id, status: inserted.status };
          vacancyByHhId.set(hhId, ours);
          createdVacancies += 1;
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
          views_count: parseNumber(getColFirst(row, 'Показы, шт.', 'Показы')) ?? 0,
          responses_count: parseNumber(getColFirst(row, 'Отклики, шт.', 'Отклики')) ?? 0,
          // SPEC: «контакты, открытые менеджером» = просмотры резюме откликнувшихся.
          contacts_opened:
            parseNumber(
              getColFirst(row, 'Просмотры резюме из отклика, шт.', 'Просмотры резюме из отклика'),
            ) ?? 0,
          invitations_sent:
            parseNumber(
              getColFirst(row, 'Приглашения из откликов, шт.', 'Приглашения из откликов'),
            ) ?? 0,
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
          rows_created_vacancies: createdVacancies,
          rows_created_users: createdUsers,
          rows_skipped: skipped.length,
          skipped_hh_ids: skipped.slice(0, 50),
          skip_reason:
            'нет «Название вакансии»/«Менеджеры» в строке CSV (создать вакансию не из чего)',
        },
      });
    }

    // ── type=politeness_managers → hh_manager_stats ───────────────────────────
    // Приоритет матчинга:
    //   1) hh_manager_id (точный, стабильный — id из HH)
    //   2) exact normalize по ФИО (legacy, для записей где hh_manager_id ещё пуст)
    //   3) первые два слова (Фамилия + Имя) — HH часто отдаёт ФИО с отчеством
    //      («Анисимова Диана Витальевна»), а в Sheets без отчества;
    //      матчим только если кандидат единственный.
    //   4) fuzzy по фамилии (для опечаток / двойных имён)
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
    // Группируем по «Фамилия Имя»: если два sheet-имени дают одинаковые
    // первые два слова — матчить нельзя (ambiguous), используем длину массива.
    const firstTwoMap = new Map<string, typeof linked>();
    for (const s of linked) {
      const key = firstTwoWords(normalizeName(s.sheet_full_name));
      const bucket = firstTwoMap.get(key) ?? [];
      bucket.push(s);
      firstTwoMap.set(key, bucket);
    }

    let matchedById = 0;
    let matchedExact = 0;
    let matchedFirstTwo = 0;
    let matchedFuzzy = 0;
    let matchedCreated = 0;
    const fuzzyMatches: FuzzyMatch[] = [];
    const skippedNames: string[] = [];

    for (const row of rows) {
      const hhName = getCol(row, 'Менеджер');
      if (!hhName) continue;
      const hhManagerId = getCol(row, 'id менеджера').trim() || null;
      const norm = normalizeName(hhName);

      // (1) Приоритет: по hh_manager_id.
      let sync = hhManagerId ? byHhId.get(hhManagerId) : undefined;
      let matchedVia: 'id' | 'exact' | 'first_two' | 'fuzzy' | 'created' | null = sync ? 'id' : null;

      // (2) По нормализованному ФИО.
      if (!sync) {
        sync = exactMap.get(norm);
        if (sync) matchedVia = 'exact';
      }

      // (3) По первым двум словам (Фамилия + Имя). Только при единственном
      //     кандидате, иначе риск перепутать однофамильцев.
      if (!sync) {
        const bucket = firstTwoMap.get(firstTwoWords(norm)) ?? [];
        if (bucket.length === 1) {
          sync = bucket[0];
          matchedVia = 'first_two';
        }
      }

      // (4) Fuzzy по фамилии.
      if (!sync) {
        const fuzzy = fuzzyManager(norm, linked);
        if (fuzzy) {
          sync = fuzzy.sync;
          matchedVia = 'fuzzy';
          fuzzyMatches.push({ hh_name: hhName, matched_to: fuzzy.sync.sheet_full_name, score: fuzzy.score });
        }
      }

      // (5) Не нашли — авто-создаём auth.user + user_profiles по ФИО из HH
      //     (см. lib/auto-provision.ts). Параллельно создаём запись в
      //     hr_manager_syncs, чтобы при следующих загрузках матч шёл по id.
      if (!sync) {
        const result = await provisionManager(db, hhName);
        if (result.userProfileId) {
          const newSync = {
            id: '',
            sheet_full_name: hhName,
            user_profile_id: result.userProfileId,
            hh_manager_id: hhManagerId,
          };
          const { data: insertedSync } = await db
            .from('hr_manager_syncs')
            .upsert(
              {
                sheet_full_name: hhName,
                user_profile_id: result.userProfileId,
                hh_manager_id: hhManagerId,
                email_sheet: result.email,
                synced_at: new Date().toISOString(),
              },
              { onConflict: 'sheet_full_name' },
            )
            .select('id')
            .single();
          newSync.id = insertedSync?.id ?? '';
          sync = newSync;
          matchedVia = 'created';
          matchedCreated += 1;
          // Прогрев кэшей — повторы в этой же сессии находят через все 3 карты.
          linked.push(newSync);
          if (hhManagerId) byHhId.set(hhManagerId, newSync);
          exactMap.set(norm, newSync);
          const ftKey = firstTwoWords(norm);
          const bucket = firstTwoMap.get(ftKey) ?? [];
          bucket.push(newSync);
          firstTwoMap.set(ftKey, bucket);
        }
      }

      if (!sync || !sync.user_profile_id) {
        skippedNames.push(hhName);
        continue;
      }

      if (matchedVia === 'id') matchedById += 1;
      else if (matchedVia === 'exact') matchedExact += 1;
      else if (matchedVia === 'first_two') matchedFirstTwo += 1;
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
          responses_received: parseNumber(
            getColFirst(row, 'Отклики, шт.', 'Отклики'),
          ),
          // Бесплатные просмотры (из входящих откликов).
          responses_viewed: parseNumber(
            getColFirst(row, 'Просмотры резюме из отклика, шт.', 'Просмотры резюме из отклика'),
          ),
          responses_answered: parseNumber(
            getColFirst(row, 'Приглашений из откликов, шт.', 'Приглашений из откликов'),
          ),
          // ⓟ Платные просмотры (менеджер искал в базе HH) — nullable, старые
          //   CSV без этой колонки → NULL.
          resume_views_from_search: parseNumber(
            getColFirst(row, 'Просмотры резюме из поиска, шт.', 'Просмотры резюме из поиска'),
          ),
          // ⓟ Платные приглашения из базы резюме.
          invitations_from_db: parseNumber(
            getColFirst(row, 'Приглашений из базы, шт.', 'Приглашений из базы'),
          ),
          // avg_response_hours: новый отчёт HH этой колонки не отдаёт → NULL.
          avg_response_hours: null,
          source_csv: 'politeness_managers',
        },
        { onConflict: 'manager_id,stat_date,source_csv' },
      );
    }

    const matched =
      matchedById + matchedExact + matchedFirstTwo + matchedFuzzy + matchedCreated;
    await logSync(db, user.id, rows.length, matched, 'ok');

    return apiSuccess({
      data: {
        report_type: reportType,
        stat_date: statDate,
        rows_parsed: rows.length,
        rows_matched: matched,
        rows_matched_by_id: matchedById,
        rows_matched_exact: matchedExact,
        rows_matched_first_two: matchedFirstTwo,
        rows_matched_fuzzy: matchedFuzzy,
        rows_created_users: matchedCreated,
        fuzzy_matches: fuzzyMatches,
        rows_skipped: skippedNames.length,
        skipped_names: skippedNames,
        skip_reason: 'createUser упал (см. логи функции)',
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

/** Перебирает алиасы заголовка и возвращает первое непустое значение.
 *  Нужен потому, что HH-отчёты пишут заголовки то с «, шт.» в конце, то без —
 *  и кратчайший вариант может случайно совпасть с другой колонкой (substring). */
function getColFirst(row: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = getCol(row, n);
    if (v) return v;
  }
  return '';
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

/** Первые два слова нормализованного ФИО («Фамилия Имя»). Используется
 *  для матчинга «Анисимова Диана Витальевна» (HH) ↔ «Анисимова Диана» (Sheets). */
function firstTwoWords(normalizedName: string): string {
  return normalizedName.split(' ').slice(0, 2).join(' ');
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
