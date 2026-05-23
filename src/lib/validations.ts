import { z } from 'zod';

/**
 * Zod-схемы для всех API-запросов.
 * Валидируют форму и диапазоны ДО обращения к БД.
 * Бизнес-проверки, зависящие от роли/контекста (например, правило «не старше
 * 30 дней» только для manager), выполняются в самих роутах (override SPEC §5.2: было 7).
 */

// ── Переиспользуемые примитивы ─────────────────────────────────────────────
/** Дата в формате YYYY-MM-DD. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате YYYY-MM-DD');

/** Счётчик активности: целое 0..999 (SPEC Блок 2). */
const countField = z
  .number({ invalid_type_error: 'Ожидается целое число от 0 до 999' })
  .int('Ожидается целое число')
  .min(0, 'Значение не может быть отрицательным')
  .max(999, 'Максимум 999');

// ── Activities ─────────────────────────────────────────────────────────────
/**
 * Тело POST /api/activities (upsert по manager_id + activity_date).
 * mango_* не принимаются от клиента — заполняются cron-ом Манго.
 * hh_calls_count может быть введён вручную (тогда роут ставит hh_calls_source='manual').
 */
export const activityUpsertSchema = z.object({
  activity_date: dateStringSchema,
  interviews_count: countField,
  offers_count: countField,
  notes: z.string().max(1000, 'Заметка не длиннее 1000 символов').nullable().optional(),
  hh_calls_count: countField.nullable().optional(),
  // Только head/admin могут писать за другого менеджера; проверка роли — в роуте.
  manager_id: z.string().uuid('Некорректный UUID менеджера').optional(),
});
export type ActivityUpsertInput = z.infer<typeof activityUpsertSchema>;

// ── Vacancies ────────────────────────────────────────────────────────────────
/** Query-параметры GET /api/vacancies. */
export const vacancyListQuerySchema = z.object({
  status: z
    .enum(['active', 'paused', 'closed', 'draft', 'all'])
    .default('active'),
  // manager_id допустим только для head/admin/executive; проверка роли — в роуте.
  manager_id: z.string().uuid('Некорректный UUID менеджера').optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type VacancyListQuery = z.infer<typeof vacancyListQuerySchema>;

/** UUID-параметр пути (например, /api/vacancies/[id]). */
export const uuidSchema = z.string().uuid();

const vacancyStatusSchema = z.enum(['active', 'paused', 'closed', 'draft']);
// HH ID — только цифры (SPEC §UI валидация формы вакансии).
const hhVacancyIdSchema = z.string().regex(/^\d+$/, 'ID на HH.ru — только цифры');

/** Тело POST /api/vacancies (создание; head/admin). */
export const vacancyCreateSchema = z.object({
  title: z.string().min(2, 'Минимум 2 символа').max(200, 'Максимум 200 символов'),
  department: z.string().max(100).nullable().optional(),
  subdivision: z.string().max(100).nullable().optional(),
  manager_id: z.string().uuid('Выберите ответственного менеджера'),
  hh_vacancy_id: hhVacancyIdSchema.nullable().optional(),
  opened_at: dateStringSchema.optional(),
  status: vacancyStatusSchema.default('active'),
});
export type VacancyCreateInput = z.infer<typeof vacancyCreateSchema>;

/** Тело PATCH /api/vacancies/[id] (редактирование; head/admin). Хотя бы одно поле. */
export const vacancyUpdateSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    department: z.string().max(100).nullable().optional(),
    subdivision: z.string().max(100).nullable().optional(),
    manager_id: z.string().uuid().optional(),
    hh_vacancy_id: hhVacancyIdSchema.nullable().optional(),
    opened_at: dateStringSchema.optional(),
    closed_at: dateStringSchema.nullable().optional(),
    status: vacancyStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Не передано ни одного поля для обновления');
export type VacancyUpdateInput = z.infer<typeof vacancyUpdateSchema>;

/** Query GET /api/dashboard/divisions. */
export const divisionsPeriodSchema = z.enum(['week', 'month', 'quarter']).default('month');

/** Тело POST /api/admin/integrations/hh/[manager_id]/connect. */
export const hhConnectSchema = z
  .object({
    access_token: z.string().min(1, 'access_token обязателен'),
    refresh_token: z.string().min(1).nullable().optional(),
    hh_manager_id: z.string().max(50).nullable().optional(),
    expires_at: z.string().datetime({ message: 'expires_at: ISO-8601' }).optional(),
    expires_in: z.number().int().positive().optional(),
  });
export type HhConnectInput = z.infer<typeof hhConnectSchema>;

// ── Периоды ──────────────────────────────────────────────────────────────────
/** Период для дашбордов (без 'all'). По умолчанию текущая неделя. */
export const dashboardPeriodSchema = z
  .enum(['today', 'week', 'month'])
  .default('week');

/** Период для воронки вакансии (включая 'all'). */
export const funnelPeriodSchema = z
  .enum(['today', 'week', 'month', 'all'])
  .default('all');

// ── Plans ──────────────────────────────────────────────────────────────────────
/**
 * Тело POST /api/plans. Поля совпадают с колонками manager_plans (SPEC Блок 2):
 * hires_per_month / vacancies_limit (а не hired_per_month/vacancy_limit).
 * effective_from опционально — по умолчанию 1-е число следующего месяца (вычисляется в роуте).
 */
export const planCreateSchema = z.object({
  manager_id: z.string().uuid('Некорректный UUID менеджера'),
  calls_per_day: z.number().int('Ожидается целое число').min(0, 'Не может быть отрицательным').max(200),
  interviews_per_day: z.number().int('Ожидается целое число').min(0, 'Не может быть отрицательным').max(50),
  hires_per_month: z.number().int('Ожидается целое число').min(0, 'Не может быть отрицательным').max(100),
  vacancies_limit: z.number().int('Ожидается целое число').min(0, 'Не может быть отрицательным').max(100),
  effective_from: dateStringSchema.optional(),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

// ── Staffing ─────────────────────────────────────────────────────────────────
/** Тело POST /api/staffing. */
export const staffingCreateSchema = z.object({
  staffing_pct: z
    .number({ invalid_type_error: 'Ожидается число от 0 до 100' })
    .int('Ожидается целое число')
    .min(0, 'Минимум 0')
    .max(100, 'Максимум 100'),
  comment: z.string().max(500, 'Комментарий не длиннее 500 символов').nullable().optional(),
});
export type StaffingCreateInput = z.infer<typeof staffingCreateSchema>;

// ── Sync ─────────────────────────────────────────────────────────────────────
/** Query GET /api/sync/logs. */
export const syncLogsQuerySchema = z.object({
  source: z.enum(['hh', 'mango', 'hh_csv', 'sheets']).optional(),
  status: z.enum(['running', 'ok', 'partial', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Query POST /api/sync/hh-csv: тип отчёта.
 * Маппинг на hh_manager_stats.source_csv выполняется в роуте:
 *   calls → 'calls', politeness → 'politeness_managers', company_politeness → 'politeness_company'.
 */
export const hhCsvTypeSchema = z.enum(['calls', 'politeness', 'company_politeness']);

// ── Bonuses ──────────────────────────────────────────────────────────────────
export const bonusesQuerySchema = z.object({
  manager_id: z.string().uuid('Некорректный UUID менеджера').optional(),
  status: z.enum(['pending', 'paid', 'all']).default('all'),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

/** Query GET /api/bonuses/summary. */
export const bonusesSummaryPeriodSchema = z
  .enum(['week', 'month', 'quarter', 'year'])
  .default('month');

/** Тело PATCH /api/bonuses/[id]/match. */
export const bonusMatchSchema = z.object({
  vacancy_id: z.string().uuid('Некорректный UUID вакансии'),
});

// ── AI ───────────────────────────────────────────────────────────────────────
export const aiInsightsQuerySchema = z.object({
  type: z.enum(['anomaly', 'forecast', 'recommendation', 'weekly_report', 'all']).default('all'),
  unread: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(10),
});

/** Тело POST /api/ai/insights/generate. */
export const aiGenerateSchema = z.object({
  type: z.enum(['anomaly', 'forecast', 'recommendation']),
  manager_id: z.string().uuid('Некорректный UUID менеджера').optional(),
  vacancy_id: z.string().uuid('Некорректный UUID вакансии').optional(),
});
export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;

// ── Admin ──────────────────────────────────────────────────────────────────────
const mangoExtensionSchema = z
  .string()
  .regex(/^\d{2,6}$/, 'Добавочный: 2–6 цифр')
  .nullable()
  .optional();

/** Тело POST /api/admin/users/invite. */
export const adminUserInviteSchema = z.object({
  email: z.string().email('Некорректный email'),
  full_name: z.string().min(2, 'Минимум 2 символа').max(100, 'Максимум 100 символов'),
  role: z.enum(['manager', 'head', 'executive', 'admin']),
});
export type AdminUserInviteInput = z.infer<typeof adminUserInviteSchema>;

/** Query GET /api/admin/audit-logs. */
export const auditLogsQuerySchema = z.object({
  table_name: z.string().max(60).optional(),
  record_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
  date_from: dateStringSchema.optional(),
  date_to: dateStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

/** Query GET /api/admin/error-logs. */
export const errorLogsQuerySchema = z.object({
  source: z
    .enum(['api', 'cron_hh', 'cron_mango', 'cron_ai', 'sync_sheets', 'hh_csv_upload', 'client'])
    .optional(),
  severity: z.enum(['warning', 'error', 'critical']).optional(),
  resolved: z.coerce.boolean().optional(),
  date_from: dateStringSchema.optional(),
  date_to: dateStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

/** Параметр недели ISO: YYYY-Www (например 2026-W21). */
export const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/, 'Формат недели: YYYY-Www');

/** Тело PATCH /api/admin/users/[id]. Хотя бы одно поле. */
export const adminUserUpdateSchema = z
  .object({
    full_name: z.string().min(2).max(100).optional(),
    role: z.enum(['manager', 'head', 'executive', 'admin']).optional(),
    is_active: z.boolean().optional(),
    mango_extension: mangoExtensionSchema,
  })
  .refine((v) => Object.keys(v).length > 0, 'Не передано ни одного поля для обновления');
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;
