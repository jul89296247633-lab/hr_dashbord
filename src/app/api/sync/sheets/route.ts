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
import { provisionManager } from '@/lib/auto-provision';

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
    let createdUsers = 0;
    for (const row of managerRows) {
      const name = pickName(row);
      if (!name) continue;
      // Фильтр строк-заголовков и мусорных значений.
      // 'HR менеджеры' / 'Нг менеджеры' — попадали в таблицу как «менеджер»
      // когда лист начинался без заголовка или с дублирующей строкой.
      if (isHeaderLikeManagerName(name)) continue;
      const emailFromSheet = pickEmail(row);
      let userProfileId =
        (emailFromSheet ? profileByEmail.get(emailFromSheet.toLowerCase()) : undefined) ??
        profileByName.get(name.toLowerCase()) ??
        null;

      // Авто-создание пользователя — общий хелпер `provisionManager`
      // (см. lib/auto-provision.ts). Триггер handle_new_user создаёт
      // user_profiles из user_metadata, ручной INSERT не нужен.
      if (!userProfileId) {
        const result = await provisionManager(db, name, emailFromSheet);
        if (result.userProfileId) {
          userProfileId = result.userProfileId;
          if (result.created) createdUsers += 1;
          // Прогрев кэшей, чтобы повторы в этой же sync-сессии находили его.
          profileByName.set(name.toLowerCase(), userProfileId);
          profileByEmail.set(result.email, userProfileId);
        }
      }

      if (!userProfileId) skippedManagers.push(name);

      await db.from('hr_manager_syncs').upsert(
        {
          sheet_full_name: name,
          user_profile_id: userProfileId,
          email_sheet: emailFromSheet || null,
          is_active_sheet: pickActive(row),
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'sheet_full_name' },
      );
    }

    // ── Data → vacancies (upsert ВСЕ) + hired_employees (закрытые / стажировка) ─
    //
    // Доступ к колонкам — по заголовкам через row.values[...], чтобы парсер
    // не ломался при сдвиге/добавлении колонок в Google Sheets.
    //
    //   «Название вакансии»  → vacancies.title
    //   «Населённый пункт»   → vacancies.location
    //   «ID HH»              → vacancies.hh_vacancy_id (опционально)
    //   «Подразделение»      → vacancies.subdivision
    //   «ФИО Заказчика»      → vacancies.customer_name
    //   «Кол-во»             → vacancies.positions_count (default 1)
    //   «Дата открытия»      → vacancies.opened_at
    //   «Дата закрытия»      → vacancies.closed_at (+ hired_employees.hired_date)
    //   «Статус»             → ветка обработки:
    //     • 'Закрыта'    → vacancies.status='closed', closed_at=«Дата закрытия»;
    //                      hired_employees: employment_type='employee', status='hired'
    //     • 'стажировка' → vacancies.status='active', closed_at=NULL (не закрываем);
    //                      hired_employees: employment_type='intern', status='probation'
    //     • иначе        → vacancies.status='active'; hired_employees не пишется
    //   «Менеджеры»          → vacancies.manager_id (через user_profiles.full_name,
    //                          первый из списка если через запятую/точку-с-запятой)
    //
    // Upsert vacancies: hh_vacancy_id заполнен → upsert по hh_vacancy_id;
    // иначе → find by (title, manager_id) → UPDATE / INSERT.

    const vacancyRows = await readSheetTab(VACANCIES_TAB());

    // Карта активных user_profiles по нормализованному ФИО (для поиска manager_id).
    const profileByNormName = new Map(
      (profiles ?? []).map((p) => [normalizeFullName(p.full_name), p.id]),
    );

    let vacanciesUpserted = 0;
    let closed = 0;
    let probation = 0;
    const skippedManagersInVacancies: { row: number; name: string }[] = [];
    const skippedNoTitle: number[] = [];

    for (const row of vacancyRows) {
      const title = (row.values['Название вакансии'] ?? '').trim();
      if (title.length < 2) {
        skippedNoTitle.push(row.rowIndex);
        continue;
      }

      // Заголовок колонки города в листе исторически плавает: «Населённый пункт»
      // (с «ё»), «Населенный пункт» (без), «Город», «Местоположение». Пробуем
      // все варианты — берём первый непустой.
      const location =
        (
          row.values['Населённый пункт'] ??
          row.values['Населенный пункт'] ??
          row.values['Город'] ??
          row.values['Местоположение'] ??
          ''
        ).trim() || null;
      const hhVacancyId = pickDigits(row.values['ID HH']);
      const subdivision = (row.values['Подразделение'] ?? '').trim() || null;
      const customerName = (row.values['ФИО Заказчика'] ?? '').trim() || null;
      const positionsCount = pickPositiveInt(row.values['Кол-во']) ?? 1;
      const openedAt = parseSheetDate(row.values['Дата открытия'] ?? '');
      // Fallback по колонке «Месяц закрытия» — HR заполняет, когда точной
      // даты нет. Берём последний день месяца 2026 года (см. MONTH_MAP внизу).
      const closedDate =
        parseSheetDate(row.values['Дата закрытия'] ?? '') ??
        parseClosedMonth(row.values['Месяц закрытия']);
      const statusCellRaw = (row.values['Статус'] ?? '').toLowerCase().trim();
      const isClosed = statusCellRaw === 'закрыта';
      // SPEC §5.3: «стажировка» — промежуточный этап. Вакансия НЕ закрывается.
      const isProbation = statusCellRaw === 'стажировка';
      // «приостановлена» и «предзакрыта» в листе Data → vacancies.status='paused'
      // (промежуточные состояния, в активные вакансии не считаются, но и не
      // закрытые). DB-енум vacancies.status поддерживает 'paused' давно.
      const isPaused =
        statusCellRaw === 'приостановлена' || statusCellRaw === 'предзакрыта';
      const status = isClosed ? 'closed' : isPaused ? 'paused' : 'active';

      // «Приоритет» из листа Data → vacancies.priority (CHECK ограничивает
      // набор значений). Любое иное → NULL, в БД попадает «не задан».
      const priorityRaw = (row.values['Приоритет'] ?? '').trim().toLowerCase();
      const priorityMapped: 'высокий' | 'средний' | 'низкий' | null =
        priorityRaw === 'высокий' ? 'высокий' :
        priorityRaw === 'средний' ? 'средний' :
        priorityRaw === 'низкий'  ? 'низкий'  : null;

      // «Менеджеры»: «Иванов И.И., Петров П.П.» → берём первого.
      const managersRaw = (row.values['Менеджеры'] ?? '').trim();
      const firstManager = managersRaw.split(/[,;]/)[0]?.trim() ?? '';
      let managerId: string | null = firstManager
        ? profileByNormName.get(normalizeFullName(firstManager)) ?? null
        : null;

      // Авто-провижининг ФИО из строки Data через общий хелпер.
      if (!managerId && firstManager) {
        const result = await provisionManager(db, firstManager);
        if (result.userProfileId) {
          managerId = result.userProfileId;
          if (result.created) createdUsers += 1;
          profileByNormName.set(normalizeFullName(firstManager), managerId);
        }
      }

      if (!managerId) {
        skippedManagersInVacancies.push({ row: row.rowIndex, name: firstManager || '(пусто)' });
        continue;
      }

      // Базовый payload (общий для INSERT и UPDATE).
      // closed_at: для probation/active явно NULL (вакансия не закрыта);
      // для closed — берём дату закрытия из колонки M.
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
        closed_at: isClosed ? closedDate : null,
        google_sheet_row: row.rowIndex,
        priority: priorityMapped,
      };

      // Upsert по hh_vacancy_id (если есть) — иначе по (title, manager_id, opened_at).
      // Три-полевой ключ важен: у одного менеджера может быть несколько вакансий
      // с одним названием, открытых в разные даты (см. migration
      // 20260523220000 + partial UNIQUE INDEX). Без opened_at в ключе раньше они
      // схлопывались в одну запись.
      let vacancyId: string | null = null;
      if (hhVacancyId) {
        const { data: upserted } = await db
          .from('vacancies')
          .upsert(payload, { onConflict: 'hh_vacancy_id' })
          .select('id')
          .single();
        vacancyId = upserted?.id ?? null;
      } else if (openedAt) {
        // Полный ключ есть → find by (title, manager_id, opened_at).
        const { data: existing } = await db
          .from('vacancies')
          .select('id')
          .eq('title', title)
          .eq('manager_id', managerId)
          .eq('opened_at', openedAt)
          .is('hh_vacancy_id', null)
          .maybeSingle();
        if (existing) {
          await db.from('vacancies').update(payload).eq('id', existing.id);
          vacancyId = existing.id;
        } else {
          const { data: inserted } = await db
            .from('vacancies')
            .insert({ ...payload, opened_at: openedAt })
            .select('id')
            .single();
          vacancyId = inserted?.id ?? null;
        }
      } else {
        // openedAt не пришёл из листа — дедуп невозможен, всегда INSERT.
        // Сегодня = fallback для NOT NULL opened_at.
        const { data: inserted } = await db
          .from('vacancies')
          .insert({ ...payload, opened_at: new Date().toISOString().slice(0, 10) })
          .select('id')
          .single();
        vacancyId = inserted?.id ?? null;
      }
      vacanciesUpserted += 1;

      // Дополнительно: пишем в hired_employees для двух статусов воронки:
      //  - 'Закрыта'    → employment_type='employee', status='hired',  hired_date = M
      //  - 'стажировка' → employment_type='intern',   status='probation',
      //                    hired_date = M (если есть) иначе openedAt иначе сегодня.
      if ((isClosed && closedDate) || isProbation) {
        if (vacancyId) {
          const employmentType = isProbation ? 'intern' : 'employee';
          const heStatus = isProbation ? 'probation' : 'hired';
          const hiredDate =
            closedDate ?? openedAt ?? new Date().toISOString().slice(0, 10);
          await db.from('hired_employees').upsert(
            {
              sheet_row_id: row.rowIndex,
              vacancy_id: vacancyId,
              position_name: title,
              hired_date: hiredDate,
              employment_type: employmentType,
              status: heStatus,
              manager_name_sheet: firstManager || null,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'sheet_row_id' },
          );
          if (isProbation) probation += 1;
          else closed += 1;
        }
      }
    }

    // ── Бонусы_HR → bonus_rates (справочник «Должность → Стоимость») ────────
    // SPEC §5.3 / §5.6: лист «Бонусы_HR» хранит тарифы закрытия должности,
    // а не журнал начислений. Бонус менеджера считается на лету в
    // /api/bonuses через RPC compute_manager_bonuses (fuzzy-match с
    // hired_employees.position_name по pg_trgm).
    //
    // Поддерживаем несколько вариантов заголовков (Должность/Позиция/Вакансия;
    // Стоимость/Сумма/Тариф) — формат листа исторически плавал.
    const bonusRows = await readSheetTab(BONUSES_TAB());
    let ratesUpserted = 0;
    for (const row of bonusRows) {
      const position =
        (row.values['Должность'] ??
          row.values['Позиция'] ??
          row.values['Вакансия'] ??
          row.values['Название'] ??
          '').trim();
      const amountRaw =
        row.values['Стоимость'] ??
        row.values['Сумма'] ??
        row.values['Тариф'] ??
        '0';
      const amountKopecks = rublesToKopecks(amountRaw);
      if (position.length < 2 || amountKopecks <= 0) continue;

      await db.from('bonus_rates').upsert(
        {
          position_name: position,
          amount_kopecks: amountKopecks,
        },
        { onConflict: 'position_name' },
      );
      ratesUpserted += 1;
    }

    const finishedAt = new Date().toISOString();
    await db
      .from('sync_logs')
      .update({
        status: 'ok',
        records_total: vacancyRows.length,
        records_updated: closed + ratesUpserted,
        finished_at: finishedAt,
      })
      .eq('id', log.id);

    return apiSuccess({
      data: {
        sync_log_id: log.id,
        status: 'ok',
        vacancies_upserted: vacanciesUpserted,
        closed,
        probation,
        // skipped_no_title: строки листа без названия (или короче 2 символов).
        skipped_no_title: skippedNoTitle.length,
        // skipped_no_manager: ФИО из колонки «Менеджеры» не найдено в user_profiles.
        skipped_no_manager: skippedManagersInVacancies.length,
        skipped_no_manager_rows: skippedManagersInVacancies,
        // SPEC §5.6: лист «Бонусы_HR» — справочник тарифов (position → amount),
        // upsert в bonus_rates по position_name.
        rates_upserted: ratesUpserted,
        skipped_managers: skippedManagers,
        // Сколько auth-пользователей создано автоматически из листа «HR_менеджеры»
        // (для тех ФИО, которых ещё не было в user_profiles).
        created_users: createdUsers,
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

/** Фильтр строк-заголовков, попадающих в лист HR-менеджеров.
 *  'HR менеджеры' — латиница, 'Нг менеджеры' — кириллический омоглиф
 *  («Н»=H, «г»=r). Также режем явно слишком короткие значения (< 5 симв.). */
function isHeaderLikeManagerName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized.length < 5) return true;
  return normalized === 'hr менеджеры' || normalized === 'нг менеджеры';
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

const MONTH_MAP: Record<string, number> = {
  'январь': 1, 'февраль': 2, 'март': 3, 'апрель': 4, 'май': 5, 'июнь': 6,
  'июль': 7, 'август': 8, 'сентябрь': 9, 'октябрь': 10, 'ноябрь': 11, 'декабрь': 12,
};

/** Fallback для «Месяц закрытия»: «май» → '2026-05-31' (последний день месяца).
 *  Год хардкод 2026 — лист Data в этом формате ведётся для текущего года. */
function parseClosedMonth(value: string | undefined): string | null {
  const raw = (value ?? '').toLowerCase().trim();
  if (!raw) return null;
  const month = MONTH_MAP[raw];
  if (!month) return null;
  // new Date(2026, month, 0) = последний день предыдущего месяца, т.е. месяца `month`.
  const lastDay = new Date(2026, month, 0).getDate();
  return `2026-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// (transliterate / emailFromName / provisionManager переехали в
//  lib/auto-provision.ts — общий хелпер для sheets и hh-csv sync.)
