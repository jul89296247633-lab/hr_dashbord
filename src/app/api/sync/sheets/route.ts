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
    let createdUsers = 0;
    for (const row of managerRows) {
      const name = pickName(row);
      if (!name) continue;
      // Фильтр строк-заголовков и мусорных значений.
      // 'HR менеджеры' / 'Нг менеджеры' — попадали в таблицу как «менеджер»
      // когда лист начинался без заголовка или с дублирующей строкой.
      if (isHeaderLikeManagerName(name)) {
        console.log('DEBUG skip header-like manager row:', name);
        continue;
      }
      const emailFromSheet = pickEmail(row);
      let userProfileId =
        (emailFromSheet ? profileByEmail.get(emailFromSheet.toLowerCase()) : undefined) ??
        profileByName.get(name.toLowerCase()) ??
        null;

      // Авто-создание пользователя, если профиль не найден.
      // user_profiles создаст триггер handle_new_user из user_metadata —
      // ручной INSERT не нужен (был бы дубль/конфликт по PK).
      // Идемпотентно: ищем профиль по обоим email-кандидатам (sheet + fallback)
      // регистронезависимо (ilike), и только потом — createUser.
      if (!userProfileId) {
        const fallbackEmail = emailFromName(name);
        const candidates = Array.from(
          new Set(
            [emailFromSheet?.toLowerCase(), fallbackEmail].filter(
              (e): e is string => Boolean(e),
            ),
          ),
        );

        for (const candidate of candidates) {
          const { data: existing } = await db
            .from('user_profiles')
            .select('id')
            .ilike('email', candidate)
            .maybeSingle();
          if (existing?.id) {
            userProfileId = existing.id;
            console.log('DEBUG attach existing by email:', candidate, '→', userProfileId);
            break;
          }
        }

        if (!userProfileId) {
          const createEmail = (emailFromSheet || fallbackEmail).toLowerCase();
          const { data: created, error: createErr } = await db.auth.admin.createUser({
            email: createEmail,
            password: crypto.randomUUID(),
            email_confirm: true,
            user_metadata: { full_name: name, role: 'manager' },
          });
          if (createErr) {
            console.log(
              'DEBUG createUser failed:', createErr.message,
              'name:', name, 'email:', createEmail,
            );
          } else if (created?.user?.id) {
            userProfileId = created.user.id;
            createdUsers += 1;
            // Прогрев кэшей, чтобы повторы в этой же sync-сессии находили его.
            profileByName.set(name.toLowerCase(), userProfileId);
            profileByEmail.set(createEmail, userProfileId);
            console.log('DEBUG created user:', userProfileId, createEmail);
          }
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
    console.log('DEBUG profileByNormName keys:', [...profileByNormName.keys()]);

    let vacanciesUpserted = 0;
    let closed = 0;
    let probation = 0;
    const skippedManagersInVacancies: { row: number; name: string }[] = [];
    const skippedNoTitle: number[] = [];

    for (const row of vacancyRows) {
      console.log(
        'DEBUG processing row:', row.rowIndex,
        'status:', row.values['Статус'],
        'manager:', row.values['Менеджеры'],
        'hhId:', row.values['ID HH'],
      );

      const title = (row.values['Название вакансии'] ?? '').trim();
      if (title.length < 2) {
        console.log('DEBUG skip reason:', 'no_title', 'row:', row.rowIndex);
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
      const closedDate = parseSheetDate(row.values['Дата закрытия'] ?? '');
      const statusCellRaw = (row.values['Статус'] ?? '').toLowerCase().trim();
      const isClosed = statusCellRaw === 'закрыта';
      // SPEC §5.3: «стажировка» — промежуточный этап. Вакансия НЕ закрывается.
      const isProbation = statusCellRaw === 'стажировка';
      const status = isClosed ? 'closed' : 'active';

      // «Менеджеры»: «Иванов И.И., Петров П.П.» → берём первого.
      const managersRaw = (row.values['Менеджеры'] ?? '').trim();
      const firstManager = managersRaw.split(/[,;]/)[0]?.trim() ?? '';
      const managerId = firstManager
        ? profileByNormName.get(normalizeFullName(firstManager)) ?? null
        : null;
      if (!managerId) {
        console.log('DEBUG skip manager:', JSON.stringify({
          row: row.rowIndex,
          name: firstManager,
          normalized: normalizeFullName(firstManager),
          availableKeys: [...profileByNormName.keys()].slice(0, 10),
        }));
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

    // DEBUG (временно): сводка цикла Data — куда делись строки.
    console.log('SYNC RESULT:', {
      total_rows: vacancyRows.length,
      vacancies_upserted: vacanciesUpserted,
      skipped_no_title: skippedNoTitle.length,
      skipped_no_manager: skippedManagersInVacancies.length,
      skipped_managers_list: skippedManagersInVacancies.slice(0, 20),
    });

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

// ── Авто-создание пользователей по списку из Sheets ─────────────────────────

const RU_TO_EN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};

/** Простая транслитерация ФИО кириллица→латиница для генерации fallback-email. */
function transliterate(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => RU_TO_EN[ch] ?? ch)
    .join('');
}

/** «Иванов Иван Иванович» → «ivanov.ivan.ivanovich@hr.local».
 *  Используется когда у менеджера в Sheets нет email — чтобы createUser
 *  получил уникальный детерминированный адрес и был идемпотентен. */
function emailFromName(name: string): string {
  const slug = transliterate(name)
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${slug || 'user'}@hr.local`;
}
