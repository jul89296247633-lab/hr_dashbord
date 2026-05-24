import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
  getPeriodRange,
  workdaysBetween,
  kpiPct,
  statusFromPct,
  currentMonthRange,
  monthRangeFromYM,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { dashboardPeriodSchema, uuidSchema } from '@/lib/validations';
import type { KpiMetricWithStatus } from '@/types';

const DEFAULT_PLAN = { calls_per_day: 15, interviews_per_day: 5, hires_per_month: 15 };

/**
 * GET /api/dashboard/manager
 * Личный KPI менеджера за период + разбивка по дням.
 * manager — свои данные; head/admin — любые через ?manager_id=uuid.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const periodParsed = dashboardPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const period = periodParsed.data;

    // Чей дашборд.
    const queryManagerId = request.nextUrl.searchParams.get('manager_id');
    let targetManagerId = user.id;
    if (queryManagerId && queryManagerId !== user.id) {
      if (!uuidSchema.safeParse(queryManagerId).success) {
        return apiError('VALIDATION_ERROR', 'Некорректный UUID менеджера', 422);
      }
      requireRole(user, ['head', 'admin']);
      targetManagerId = queryManagerId;
    }

    const monthParam = request.nextUrl.searchParams.get('month') ?? undefined;
    const usingPickedMonth = period === 'month' && monthParam !== undefined;
    const monthWindow = usingPickedMonth ? monthRangeFromYM(monthParam) : null;
    const { from, to } = monthWindow ?? getPeriodRange(period);
    const workdays = workdaysBetween(from as string, to as string);

    const supabase = await createClient();

    // Профиль менеджера (RLS: свой — всегда; чужой — для head/admin).
    // is_active нужен для бейджа «Уволен» в UI (EC-08).
    const { data: manager, error: managerError } = await supabase
      .from('user_profiles')
      .select('id, full_name, is_active')
      .eq('id', targetManagerId)
      .maybeSingle();
    if (managerError) throw new ApiError(500, 'DB_ERROR', managerError.message);
    if (!manager) return apiError('MANAGER_NOT_FOUND', 'Менеджер не найден', 404);

    // Активный план.
    const { data: plans, error: plansError } = await supabase
      .from('manager_plans')
      .select('calls_per_day, interviews_per_day, hires_per_month, effective_from, created_at')
      .eq('manager_id', targetManagerId)
      .lte('effective_from', to as string)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (plansError) throw new ApiError(500, 'DB_ERROR', plansError.message);
    const plan = plans?.[0] ?? DEFAULT_PLAN;

    // Активности за период.
    const { data: activities, error: activitiesError } = await supabase
      .from('daily_activities')
      .select('activity_date, mango_calls_count, hh_calls_count, interviews_count')
      .eq('manager_id', targetManagerId)
      .gte('activity_date', from as string)
      .lte('activity_date', to as string)
      .order('activity_date', { ascending: true });
    if (activitiesError) throw new ApiError(500, 'DB_ERROR', activitiesError.message);

    // Активные вакансии (только из листа «Data» — hh_vacancy_id !== NULL).
    const { count: activeVacancies, error: vacError } = await supabase
      .from('vacancies')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', targetManagerId)
      .eq('status', 'active')
      .not('hh_vacancy_id', 'is', null);
    if (vacError) throw new ApiError(500, 'DB_ERROR', vacError.message);

    // «Закрыто вакансий» — за выбранный месяц (MonthPicker) или текущий.
    // Источник: vacancy_snapshots WHERE is_closed=true («Закрытая»=Да из CSV).
    const month = monthWindow ?? currentMonthRange();
    const { data: closedSnapshots, error: closedError } = await supabase
      .from('vacancy_snapshots')
      .select('vacancy_id, snapshot_at, vacancy:vacancies!vacancy_snapshots_vacancy_id_fkey(manager_id)')
      .eq('is_closed', true)
      .gte('snapshot_at', `${month.from}T00:00:00Z`)
      .lte('snapshot_at', `${month.to}T23:59:59Z`);
    if (closedError) throw new ApiError(500, 'DB_ERROR', closedError.message);
    // Дедуп по vacancy_id и фильтр по targetManagerId.
    const closedThisMonth = new Map<string, { snapshot_at: string }>();
    for (const s of (closedSnapshots ?? []) as Array<{
      vacancy_id: string;
      snapshot_at: string;
      vacancy: { manager_id: string | null } | null;
    }>) {
      if (s.vacancy?.manager_id !== targetManagerId) continue;
      if (!closedThisMonth.has(s.vacancy_id)) {
        closedThisMonth.set(s.vacancy_id, { snapshot_at: s.snapshot_at });
      }
    }
    const hiredFact = closedThisMonth.size;

    // Стажёры по-прежнему за выбранный period — это «промежуточный этап»,
    // не относится к плану/факту найма.
    const { data: interns, error: internsError } = await supabase
      .from('hired_employees')
      .select('hired_date, vacancy:vacancies!hired_employees_vacancy_id_fkey(manager_id)')
      .eq('status', 'probation')
      .gte('hired_date', from as string)
      .lte('hired_date', to as string);
    if (internsError) throw new ApiError(500, 'DB_ERROR', internsError.message);
    const probationFact = (interns ?? []).filter(
      (h) => h.vacancy?.manager_id === targetManagerId,
    ).length;

    // Факты.
    const callsFact = (activities ?? []).reduce(
      (s, a) => s + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0),
      0,
    );
    const interviewsFact = (activities ?? []).reduce((s, a) => s + (a.interviews_count ?? 0), 0);

    const kpi = {
      calls: kpiMetric(callsFact, plan.calls_per_day * workdays),
      interviews: kpiMetric(interviewsFact, plan.interviews_per_day * workdays),
      // План — hires_per_month как есть (метрика помесячная).
      hires: kpiMetric(hiredFact, plan.hires_per_month),
    };

    // Найм по дням — берём snapshot_at (date только), считаем уникальные
    // vacancy_id за день. Уже отфильтровано по targetManagerId выше.
    const hiredByDate = new Map<string, number>();
    for (const [, info] of closedThisMonth) {
      const day = info.snapshot_at.slice(0, 10);
      hiredByDate.set(day, (hiredByDate.get(day) ?? 0) + 1);
    }

    // Разбивка по дням (по дням, где есть активности).
    const by_day = (activities ?? []).map((a) => ({
      date: a.activity_date,
      calls: (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0),
      interviews: a.interviews_count ?? 0,
      hired: hiredByDate.get(a.activity_date) ?? 0,
    }));

    return apiSuccess({
      data: {
        manager: {
          id: manager.id,
          full_name: manager.full_name,
          is_active: manager.is_active,
        },
        period,
        kpi,
        active_vacancies_count: activeVacancies ?? 0,
        // SPEC §5.3 / Блок 3.1: «На стажировке» — счётчик без плана,
        // только факт (промежуточный этап воронки).
        probation_count: probationFact,
        by_day,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function kpiMetric(fact: number, plan: number): KpiMetricWithStatus {
  const pct = kpiPct(fact, plan);
  return { fact, plan, pct, status: statusFromPct(pct) };
}
