/**
 * Кастомные доменные типы HR Control Tower.
 * Re-export генерируемой схемы + ручные типы строк/ответов API.
 * Поля БД — строго snake_case (как в SPEC Блок 2).
 */
export type { Database } from './database';

// ── Роли и авторизация ─────────────────────────────────────────────────────
export type Role = 'manager' | 'head' | 'executive' | 'admin';

// ── Периоды и KPI ───────────────────────────────────────────────────────────
export type Period = 'today' | 'week' | 'month' | 'all';

/** Статус выполнения KPI (метки по ТЗ). */
export type ManagerStatus = 'on_track' | 'lagging' | 'critical';

/** Метрика KPI: факт vs план + % выполнения. */
export interface KpiMetric {
  fact: number;
  plan: number;
  pct: number;
}

/** KPI-метрика с собственным статусом (для личного дашборда). */
export interface KpiMetricWithStatus extends KpiMetric {
  status: ManagerStatus;
}

/** Строка KPI менеджера в сводном дашборде команды. */
export interface ManagerKpi {
  id?: string; // отсутствует для роли executive (EC-09)
  full_name?: string; // отсутствует для роли executive (EC-09)
  is_active?: boolean; // false → бейдж «Уволен» в UI (исторические данные показываем)
  calls: KpiMetric;
  interviews: KpiMetric;
  hired: KpiMetric;
  active_vacancies: number;
  status: ManagerStatus;
}

/** Этап воронки вакансии с конверсией в следующий этап. */
export interface FunnelStage {
  stage: string;
  count: number;
  conversion_pct: number | null;
}

export interface AuthUser {
  id: string;
  role: Role;
  full_name: string;
}

// ── Строки таблиц (подмножество полей, используемых в API-слое) ────────────
export type CallsSource = 'mango_api' | 'hh_csv' | 'manual' | 'pending';

export interface DailyActivity {
  id: string;
  manager_id: string;
  activity_date: string;
  mango_calls_count: number | null;
  mango_calls_source: CallsSource;
  hh_calls_count: number | null;
  hh_calls_source: CallsSource;
  interviews_count: number;
  offers_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Активность с рассчитанным на сервере total_calls (Манго + HH). */
export interface DailyActivityWithTotal extends DailyActivity {
  total_calls: number;
}

export type VacancyStatus = 'active' | 'paused' | 'closed' | 'draft';

export interface Vacancy {
  id: string;
  hh_vacancy_id: string | null;
  title: string;
  department: string | null;
  subdivision: string | null;
  location: string | null;
  manager_id: string;
  status: VacancyStatus;
  opened_at: string;
  closed_at: string | null;
  days_to_close: number | null;
  google_sheet_row: number | null;
  created_at: string;
  updated_at: string;
}

/** Вакансия из списка с вложенным менеджером (для head/admin). */
export interface VacancyListItem extends Vacancy {
  manager: { id: string; full_name: string; is_active?: boolean } | null;
}

export interface VacancySnapshot {
  id: string;
  vacancy_id: string;
  snapshot_at: string;
  responses_count: number;
  contacts_opened: number;
  invitations_sent: number;
  views_count: number;
  source: 'hh_api' | 'manual';
  created_at: string;
}

/** Воронка по вакансии (агрегат последнего snapshot + найм). */
export interface VacancyFunnel {
  responses: number;
  contacts_opened: number;
  invitations_sent: number;
  views: number;
  hired: number;
}
