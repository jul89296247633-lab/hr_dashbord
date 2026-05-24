import type { KpiMetric, ManagerStatus } from '@/types';

export type DashboardPeriod = 'today' | 'week' | 'month';

export interface TeamManagerKpi {
  id?: string;
  full_name?: string;
  // false → бейдж «Уволен» в UI (EC-08: историческая статистика остаётся)
  is_active?: boolean;
  calls: KpiMetric;
  interviews: KpiMetric;
  hired: KpiMetric;
  active_vacancies: number;
  status: ManagerStatus;
}

export interface TeamResponse {
  period: string;
  summary: {
    calls: KpiMetric;
    interviews: KpiMetric;
    hired: KpiMetric;
    active_vacancies: number;
  };
  managers: TeamManagerKpi[];
}

export interface DivisionFunnel {
  responses: number;
  contacts_opened: number;
  invitations_from_responses: number;
  invitations_from_db: number;
  calls: number;
  hired: number;
  interns: number;
}

export interface Division {
  subdivision: string;
  active_vacancies: number;
  closed_in_period: number;
  avg_days_to_close: number | null;
  interns: number;
  hired_in_period: number;
  plan_completion_pct: number | null;
  funnel: DivisionFunnel;
}

export interface DivisionsResponse {
  period: string;
  divisions: Division[];
}

export interface StaffingCurrent {
  staffing_pct: number;
  comment: string | null;
  recorded_at: string;
}

export interface StaffingResponse {
  current: StaffingCurrent | null;
}

export interface PolitenessManager {
  manager_id: string;
  politeness_index: number | null;
}

export interface PolitenessResponse {
  company: { politeness_index: number | null } | null;
  managers: PolitenessManager[];
}
