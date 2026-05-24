import { type NextRequest } from 'next/server';
import {
  getAuthUser,
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
import { dashboardPeriodSchema } from '@/lib/validations';
import type { KpiMetricWithStatus } from '@/types';

const DEFAULT_PLAN = { calls_per_day: 15, interviews_per_day: 5, hires_per_month: 15 };

/**
 * GET /api/dashboard/me — личный KPI текущего пользователя за период + разбивка по дням.
 * Любая авторизованная роль; всегда считается по auth.uid() (без manager_id).
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
    const monthParam = request.nextUrl.searchParams.get('month') ?? undefined;
    const usingPickedMonth = period === 'month' && monthParam !== undefined;
    const monthWindow = usingPickedMonth ? monthRangeFromYM(monthParam) : null;
    const { from, to } = monthWindow ?? getPeriodRange(period);
    const workdays = workdaysBetween(from as string, to as string);

    const supabase = await createClient();

    const { data: plans, error: plansError } = await supabase
      .from('manager_plans')
      .select('calls_per_day, interviews_per_day, hires_per_month, effective_from, created_at')
      .eq('manager_id', user.id)
      .lte('effective_from', to as string)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (plansError) throw new ApiError(500, 'DB_ERROR', plansError.message);
    const plan = plans?.[0] ?? DEFAULT_PLAN;

    const { data: activities, error: activitiesError } = await supabase
      .from('daily_activities')
      .select('activity_date, mango_calls_count, hh_calls_count, interviews_count')
      .eq('manager_id', user.id)
      .gte('activity_date', from as string)
      .lte('activity_date', to as string)
      .order('activity_date', { ascending: true });
    if (activitiesError) throw new ApiError(500, 'DB_ERROR', activitiesError.message);

    const { count: activeVacancies, error: vacError } = await supabase
      .from('vacancies')
      .select('id', { count: 'exact', head: true })
      .eq('manager_id', user.id)
      .eq('status', 'active')
      // Только вакансии из листа «Data» (hh_vacancy_id !== NULL).
      .not('hh_vacancy_id', 'is', null);
    if (vacError) throw new ApiError(500, 'DB_ERROR', vacError.message);

    // «Закрыто вакансий» — vacancies WHERE status='closed' AND closed_at ∈ month.
    const month = monthWindow ?? currentMonthRange();
    const { data: closedThisMonth, error: closedError } = await supabase
      .from('vacancies')
      .select('id, closed_at')
      .eq('manager_id', user.id)
      .eq('status', 'closed')
      .gte('closed_at', month.from)
      .lte('closed_at', month.to);
    if (closedError) throw new ApiError(500, 'DB_ERROR', closedError.message);

    const callsFact = (activities ?? []).reduce(
      (s, a) => s + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0),
      0,
    );
    const interviewsFact = (activities ?? []).reduce((s, a) => s + (a.interviews_count ?? 0), 0);

    const kpi = {
      calls: kpiMetric(callsFact, plan.calls_per_day * workdays),
      interviews: kpiMetric(interviewsFact, plan.interviews_per_day * workdays),
      hires: kpiMetric((closedThisMonth ?? []).length, plan.hires_per_month),
    };

    const hiredByDate = new Map<string, number>();
    for (const v of closedThisMonth ?? []) {
      if (!v.closed_at) continue;
      hiredByDate.set(v.closed_at, (hiredByDate.get(v.closed_at) ?? 0) + 1);
    }

    const by_day = (activities ?? []).map((a) => ({
      date: a.activity_date,
      calls: (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0),
      interviews: a.interviews_count ?? 0,
      hired: hiredByDate.get(a.activity_date) ?? 0,
    }));

    return apiSuccess({
      data: {
        manager: { id: user.id, full_name: user.full_name },
        period,
        kpi,
        active_vacancies_count: activeVacancies ?? 0,
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
