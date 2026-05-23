import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  readSheetTab,
  parseSheetDate,
  rublesToKopecks,
  VACANCIES_TAB,
  MANAGERS_TAB,
  BONUSES_TAB,
  type SheetRow,
} from '@/lib/google-sheets';

/**
 * POST /api/sync/sheets — ручная синхронизация Google Sheets (head, admin).
 *
 * Три вкладки:
 *  - «HR_менеджеры» → hr_manager_syncs
 *  - «Data» (вакансии) → vacancies (upsert ВСЕ строки) + hired_employees (только закрытые)
 *  - «Бонусы_HR» → hr_bonuses
 *
 * Запись — service-role (RLS service_write).
 * Блокирует параллельный запуск (EC-06): sync_logs running за последние 10 минут → 409.
 *
 * Маппинг колонок листа «Data» — см. блок «── Data → vacancies ──» ниже.
 */
export async function POST() {
  let user;
  try {
    user = await getAuthUser();
    requireRole(user, ['head', 'admin']);
  } catch (err) {
    return handleApiError(err);
  }

  const db = createAdminClient();

  // EC-06: уже запущена?
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: running } = await db
    .from('sync_logs')
    .select('id')
    .eq('source', 'sheets')
    .eq('status', 'running')
    .gte('started_at', tenMinAgo)
    .limit(1);
  if (running && running.length > 0) {
    return apiError(
      'SYNC_ALREADY_RUNNING',
      'Синхронизация Google Sheets уже выполняется. Подождите завершения.',
      409,
    );
  }

  // Открываем лог.
  const { data: log, error: logError } = await db
    .from('sync_logs')
    .insert({ source: 'sheets', status: 'running', triggered_by: user.id })
    .select('id, started_at')
    .single();
  if (logError || !log) {
    return handleApiError(new ApiError(500, 'DB_ERROR', logError?.message ?? 'sync_logs insert failed'));
  }

  try {
    // ── HR менеджеры → hr_manager_syncs ──────────────────────────────────────
    const managerRows = await readSheetTab(MANAGERS_TAB());
    const { data: profiles } = await db
      .from('user_profiles')
      .select('id, full_name, email');
    const profileByName = new Map((profiles ?? []).map((p) => [p.full_name.trim().toLowerCase(), p.id]));
    const profileByEmail = new Map(
      (profiles ?? []).filter((p) => p.email).map((p) => [p.email.trim().toLowerCase(), p.id]),
    );

    const skippedManagers: string[] = [];
    for (const row of managerRows) {
      const name = pickName(row);
      if (!name) continue;
      const email = pickEmail(row);
      const userProfileId =
        (email ? profileByEmail.get(email.toLowerCase()) : undefined) ??
        profileByName.get(name.toLowerCase()) ??
        null;
      if (!userProfileId) skippedManagers.push(name);

      await db.from('hr_manager_syncs').upsert(
        {
          sheet_full_name: name,
          user_profile_id: userProfileId,
          email_sheet: email || null,
          is_active_sheet: pickActive(row),
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'sheet_full_name' },
      );
    }

    // Карта имя → manager_sync_id (для бонусов).
    const { data: syncs } = await db
      .from('hr_manager_syncs')
      .select('id, sheet_full_name, user_profile_id');
    const syncByName = new Map(
      (syncs ?? []).map((s) => [s.sheet_full_name.trim().toLowerCase(), s]),
    );

    // ── Data → vacancies (upsert ВСЕ) + hired_employees (только закрытые) ────
    //
    // Маппинг колонок листа «Data» (строка 1 — заголовки):
    //   A  «Название вакансии»          → vacancies.title
    //   B  «Населённый пункт»           → vacancies.location
    //   C  «ID HH»                       → vacancies.hh_vacancy_id (опционально)
    //   D  «Формат поиска ...»          — игнорируем
    //   E  «Причина появления вакансии» — игнорируем
    //   F  «Расширенное описание ...»   — игнорируем
    //   G  «Подразделение»              → vacancies.subdivision
    //   H  «ФИО Заказчика»              → vacancies.customer_name
    //   I  «Приоритет»                  — игнорируем
    //   J  «Кол-во»                      → vacancies.positions_count (default 1)
    //   K  «Дата открытия»              → vacancies.opened_at
    //   L  «Месяц закрытия»             — игнорируем
    //   M  «Дата закрытия»              → vacancies.closed_at (+ hired_employees.hired_date)
    //   N  (пустой заголовок)            → vacancies.status: 'Закрыта' → 'closed', иначе 'active'
    //   O  «Менеджеры»                  → vacancies.manager_id (через user_profiles.full_name,
    //                                     первый из списка если через запятую/точку-с-запятой)
    //   P  «Кол-во дней в работе»       — игнорируем
    //   Q  «ФИО кандидата»              — игнорируем
    //   R  «Комментарий»                — игнорируем
    //
    // Upsert vacancies:
    //   - hh_vacancy_id заполнен → upsert по hh_vacancy_id
    //   - иначе → find by (title, manager_id) → UPDATE / INSERT
    //
    // Для строк со статусом 'Закрыта' дополнительно пишем в hired_employees
    // (sheet_row_id как ключ — идемпотентно).

    const vacancyRows = await readSheetTab(VACANCIES_TAB());

    // Карта активных user_profiles по нормализованному ФИО (для поиска manager_id).
    const profileByNormName = new Map(
      (profiles ?? []).map((p) => [normalizeFullName(p.full_name), p.id]),
    );

    let vacanciesUpserted = 0;
    let closed = 0;
    const skippedManagersInVacancies: { row: number; name: string }[] = [];
    const skippedNoTitle: number[] = [];

    for (const row of vacancyRows) {
      const title = (row.cells[0] ?? '').trim(); // A
      if (title.length < 2) {
        skippedNoTitle.push(row.rowIndex);
        continue;
      }

      const location = (row.cells[1] ?? '').trim() || null; // B
      const hhVacancyId = pickDigits(row.cells[2]); // C — только цифры или null
      const subdivision = (row.cells[6] ?? '').trim() || null; // G
      const customerName = (row.cells[7] ?? '').trim() || null; // H
      const positionsCount = pickPositiveInt(row.cells[9]) ?? 1; // J
      const openedAt = parseSheetDate(row.cells[10] ?? ''); // K
      const closedDate = parseSheetDate(row.cells[12] ?? ''); // M
      const statusCellRaw = (row.cells[13] ?? '').toLowerCase().trim(); // N (пустой заголовок)
      const isClosed = statusCellRaw === 'закрыта';
      const status = isClosed ? 'closed' : 'active';

      // O — «Менеджеры»: «Иванов И.И., Петров П.П.» → берём первого.
      const managersRaw = (row.cells[14] ?? '').trim();
      const firstManager = managersRaw.split(/[,;]/)[0]?.trim() ?? '';
      const managerId = firstManager
        ? profileByNormName.get(normalizeFullName(firstManager)) ?? null
        : null;
      if (!managerId) {
        skippedManagersInVacancies.push({ row: row.rowIndex, name: firstManager || '(пусто)' });
        continue;
      }

      // Базовый payload (общий для INSERT и UPDATE).
      const payload = {
        hh_vacancy_id: hhVacancyId,
        title,
        subdivision,
        location,
        customer_name: customerName,
        positions_count: positionsCount,
        manager_id: managerId,
        status,
        opened_at: openedAt ?? undefined, // не перетираем NOT NULL пустым значением
        closed_at: closedDate, // nullable — пишем как есть
        google_sheet_row: row.rowIndex,
      };

      // Upsert по hh_vacancy_id (если есть) — иначе ручной find by (title, manager_id).
      let vacancyId: string | null = null;
      if (hhVacancyId) {
        const { data: upserted } = await db
          .from('vacancies')
          .upsert(payload, { onConflict: 'hh_vacancy_id' })
          .select('id')
          .single();
        vacancyId = upserted?.id ?? null;
      } else {
        const { data: existing } = await db
          .from('vacancies')
          .select('id')
          .eq('title', title)
          .eq('manager_id', managerId)
          .maybeSingle();
        if (existing) {
          await db.from('vacancies').update(payload).eq('id', existing.id);
          vacancyId = existing.id;
        } else {
          const { data: inserted } = await db
            .from('vacancies')
            .insert({ ...payload, opened_at: openedAt ?? new Date().toISOString().slice(0, 10) })
            .select('id')
            .single();
          vacancyId = inserted?.id ?? null;
        }
      }
      vacanciesUpserted += 1;

      // Дополнительно: закрытые → hired_employees (для бонусов и истории найма).
      if (isClosed && closedDate && vacancyId) {
        await db.from('hired_employees').upsert(
          {
            sheet_row_id: row.rowIndex,
            vacancy_id: vacancyId,
            position_name: title,
            hired_date: closedDate,
            employment_type: 'employee',
            manager_name_sheet: firstManager || null,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'sheet_row_id' },
        );
        closed += 1;
      }
    }

    // ── Бонусы_HR → hr_bonuses ───────────────────────────────────────────────
    const bonusRows = await readSheetTab(BONUSES_TAB());
    let bonusesUpserted = 0;
    for (const row of bonusRows) {
      const vacancyTitle = (row.values['Вакансия'] ?? row.values['Название'] ?? '').trim();
      const managerName = (row.values['Менеджер'] ?? '').trim();
      const bonusDate = parseSheetDate(row.values['Дата'] ?? '');
      if (vacancyTitle.length < 2 || managerName.length < 2 || !bonusDate) continue;

      const sync = syncByName.get(managerName.toLowerCase());
      const { data: fuzzyVac } = await db.rpc('fuzzy_match_vacancy', {
        search_title: vacancyTitle,
        threshold: 0.8,
      });
      const vacancyId = fuzzyVac && fuzzyVac.length > 0 ? fuzzyVac[0].id : null;

      const statusRaw = (row.values['Статус'] ?? '').toLowerCase();
      await db.from('hr_bonuses').upsert(
        {
          sheet_row_id: row.rowIndex,
          manager_sync_id: sync?.id ?? null,
          manager_id: sync?.user_profile_id ?? null,
          vacancy_id: vacancyId,
          vacancy_title_sheet: vacancyTitle,
          manager_name_sheet: managerName,
          bonus_amount_kopecks: rublesToKopecks(row.values['Сумма'] ?? '0'),
          bonus_date: bonusDate,
          status: statusRaw.includes('выплач') ? 'paid' : 'pending',
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'sheet_row_id' },
      );
      bonusesUpserted += 1;
    }

    const finishedAt = new Date().toISOString();
    await db
      .from('sync_logs')
      .update({
        status: 'ok',
        records_total: vacancyRows.length,
        records_updated: closed + bonusesUpserted,
        finished_at: finishedAt,
      })
      .eq('id', log.id);

    return apiSuccess({
      data: {
        sync_log_id: log.id,
        status: 'ok',
        vacancies_upserted: vacanciesUpserted,
        closed,
        // skipped_no_title: строки листа без названия (или короче 2 символов).
        skipped_no_title: skippedNoTitle.length,
        // skipped_no_manager: ФИО из колонки «Менеджеры» не найдено в user_profiles.
        skipped_no_manager: skippedManagersInVacancies.length,
        skipped_no_manager_rows: skippedManagersInVacancies,
        bonuses_upserted: bonusesUpserted,
        skipped_managers: skippedManagers,
        started_at: log.started_at,
        finished_at: finishedAt,
      },
    });
  } catch (err) {
    // Фиксируем провал синхронизации в логе.
    const message = err instanceof Error ? err.message : 'Unknown sync error';
    const isAuth = /permission|denied|credential|auth/i.test(message);
    await db
      .from('sync_logs')
      .update({
        status: 'error',
        error_code: isAuth ? 'SHEETS_AUTH_ERROR' : 'SHEETS_SYNC_ERROR',
        error_message: message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', log.id);

    if (isAuth) {
      return apiError(
        'SHEETS_AUTH_ERROR',
        'Ошибка доступа к Google Sheets. Проверьте service account в настройках интеграций.',
        502,
      );
    }
    return handleApiError(err);
  }
}

// ── Допущения по заголовкам вкладки «HR менеджеры» ──────────────────────────
function pickName(row: SheetRow): string {
  return (
    row.values['ФИО'] ||
    row.values['Менеджер'] ||
    row.values['Имя'] ||
    Object.values(row.values)[0] ||
    ''
  ).trim();
}

function pickEmail(row: SheetRow): string {
  return (row.values['Email'] || row.values['email'] || row.values['Почта'] || '').trim();
}

function pickActive(row: SheetRow): boolean {
  const raw = (row.values['Активен'] || row.values['Статус'] || '').toLowerCase().trim();
  if (!raw) return true;
  return !/неактив|уволен|нет|false|0/.test(raw);
}

// ── Хелперы для парсинга колонок листа «Data» ───────────────────────────────

/** Нормализация ФИО для поиска в `user_profiles.full_name`
 *  (lower, ё→е, схлопывание пробелов). */
function normalizeFullName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Берём только цифры из строки; пусто/нечисловое → null. Используется для
 *  колонки «ID HH» — HH-идентификаторы всегда числовые. */
function pickDigits(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return raw;
}

/** Положительное целое из ячейки или null. Для колонки «Кол-во». */
function pickPositiveInt(value: string | undefined): number | null {
  const raw = (value ?? '').replace(/\s/g, '').replace(',', '.');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
