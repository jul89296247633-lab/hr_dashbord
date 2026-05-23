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
 * Три вкладки: «HR менеджеры» → hr_manager_syncs, «Вакансии» (закрытые) →
 * hired_employees, «Бонусы_HR» → hr_bonuses. Запись — service-role (RLS service_write).
 *
 * Блокирует параллельный запуск (EC-06): sync_logs running за последние 10 минут → 409.
 *
 * Допущения по заголовкам вкладок (Sheets не типизирован) задокументированы в pick*().
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

    // ── Вакансии (закрытые) → hired_employees ────────────────────────────────
    const vacancyRows = await readSheetTab(VACANCIES_TAB());
    let closed = 0;
    let unmatched = 0; // HH ID есть в строке, но вакансия с таким hh_vacancy_id не найдена в БД
    const skippedNoHhId: number[] = []; // rowIndexes строк с пустым/нечисловым HH ID

    for (const row of vacancyRows) {
      const status = (row.values['Статус'] ?? '').toLowerCase().trim();
      const closedDate = parseSheetDate(row.values['Дата закрытия'] ?? '');
      if (status !== 'закрыта' || !closedDate) continue;

      const positionName = (row.values['Название'] ?? '').trim();
      if (positionName.length < 2) continue;

      // Новый контракт (2026-05-23): импорт ТРЕБУЕТ непустой числовой "HH ID";
      // fuzzy-поиск по названию убран. См. миграцию 20260523123000_*.
      const hhId = pickHhId(row);
      if (!hhId) {
        skippedNoHhId.push(row.rowIndex);
        continue;
      }

      // Точный матч по vacancies.hh_vacancy_id.
      const { data: byHh } = await db
        .from('vacancies')
        .select('id')
        .eq('hh_vacancy_id', hhId)
        .maybeSingle();
      const vacancyId: string | null = byHh?.id ?? null;
      if (!vacancyId) unmatched += 1;

      const isIntern = (row.values['Тип найма'] ?? '').toLowerCase().includes('стаж');
      await db.from('hired_employees').upsert(
        {
          sheet_row_id: row.rowIndex,
          vacancy_id: vacancyId,
          position_name: positionName,
          hired_date: closedDate,
          employment_type: isIntern ? 'intern' : 'employee',
          manager_name_sheet: (row.values['Менеджер'] ?? '').trim() || null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'sheet_row_id' },
      );
      closed += 1;
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
        closed,
        // unmatched: HH ID был в строке, но вакансия с таким hh_vacancy_id не найдена в БД.
        unmatched,
        // skipped_no_hh_id: строки с пустым/нечисловым "HH ID" (новый контракт после 2026-05-23).
        skipped_no_hh_id: skippedNoHhId.length,
        skipped_no_hh_id_rows: skippedNoHhId,
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

// ── Допущения по заголовкам вкладки «Вакансии» ──────────────────────────────
// "HH ID" — обязательная числовая колонка для синхронизации (см. миграцию
// 20260523123000_*). Принимаем "HH ID" или "ID" как фолбэк, только цифры.
function pickHhId(row: SheetRow): string | null {
  const raw = (row.values['HH ID'] ?? row.values['ID'] ?? '').trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  return raw;
}
