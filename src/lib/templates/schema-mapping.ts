/**
 * Единый маппинг: имена листов XLSX ↔ колонки ↔ поля БД.
 * Используется при генерации пустого шаблона (download) и при парсинге (upload).
 * Заголовки и порядок колонок совпадают с текущими Google Sheets листами.
 */

export type TemplateType = 'data' | 'bonus_rates' | 'hr_list' | 'staffing_plan' | 'combined';

/** Ожидаемые имена листов в XLSX (как пользователь должен их назвать). */
export const SHEET_NAMES = {
  data: 'Data',
  bonus_rates: 'Бонусы_HR',
  hr_list: 'Список HR',
  staffing_plan: 'Штатное расписание',
} as const satisfies Record<Exclude<TemplateType, 'combined'>, string>;

export type SheetType = keyof typeof SHEET_NAMES;

/** Колонки шаблона Data → таблица vacancies. */
export const DATA_COLUMNS = [
  'Название вакансии',  // vacancies.title (required)
  'ID HH',             // vacancies.hh_vacancy_id (nullable — пусто у конфиденциальных)
  'Город',             // vacancies.location (nullable)
  'Дата открытия',     // vacancies.opened_at DD.MM.YYYY (required)
  'Дата закрытия',     // vacancies.closed_at DD.MM.YYYY (nullable)
  'Статус',            // 'Закрыта' → 'closed'; иначе 'active'
  'Конфиденциальность', // 'Да' → 'confidential'; иначе 'open'
  'Менеджеры',         // → user_profiles.full_name lookup → manager_id (nullable)
  'Подразделение',     // vacancies.subdivision (nullable)
  'Приоритет',         // vacancies.priority: высокий/средний/низкий (nullable)
] as const;

/** Колонки шаблона Бонусы_HR → таблица bonus_rates. */
export const BONUS_RATES_COLUMNS = [
  'Должность',           // bonus_rates.position_name (required, UNIQUE)
  'Сумма бонуса (руб)', // bonus_rates.amount_kopecks (required; ×100 → kopecks)
  'Группа',             // bonus_rates.group_name (nullable)
] as const;

/** Колонки шаблона Список HR → user_profiles + hr_manager_syncs. */
export const HR_LIST_COLUMNS = [
  'ФИО',          // user_profiles.full_name / hr_manager_syncs.sheet_full_name (required)
  'Email',        // user_profiles.email (required)
  'Роль',         // user_profiles.role: manager/head/executive/admin (required)
  'HH Manager ID', // hr_manager_syncs.hh_manager_id (nullable)
] as const;

/** Колонки шаблона Штатное расписание → таблица staffing_plan. */
export const STAFFING_PLAN_COLUMNS = [
  'Город',         // staffing_plan.city (required)
  'Должность',     // staffing_plan.position_name (required)
  'Кол-во единиц', // staffing_plan.planned_units (required, 0..999)
  'Занято',        // staffing_plan.occupied_units (optional, 0..999, default 0)
  'Комментарий',   // staffing_plan.comment (nullable)
] as const;

/** Все колонки по типу листа — для генерации заголовков шаблона. */
export const COLUMNS_BY_SHEET = {
  data: DATA_COLUMNS,
  bonus_rates: BONUS_RATES_COLUMNS,
  hr_list: HR_LIST_COLUMNS,
  staffing_plan: STAFFING_PLAN_COLUMNS,
} as const satisfies Record<SheetType, readonly string[]>;

/** Листы, входящие в «combined» шаблон. */
export const COMBINED_SHEETS: SheetType[] = ['data', 'bonus_rates', 'hr_list', 'staffing_plan'];

/** Допустимые значения роли (русские + английские) → код роли в БД. */
export const ROLE_MAP: Record<string, string> = {
  'менеджер': 'manager',
  'manager': 'manager',
  'руководитель hr': 'head',
  'руководитель': 'head',
  'head': 'head',
  'топ-менеджмент': 'executive',
  'топ менеджмент': 'executive',
  'executive': 'executive',
  'администратор': 'admin',
  'admin': 'admin',
};
