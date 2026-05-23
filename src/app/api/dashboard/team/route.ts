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
  calcManagerStatus,
  currentMonthRange,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { dashboardPeriodSchema } from '@/lib/validations';
import type { KpiMetric, ManagerKpi } from '@/types';

// Дефолты плана (manager_plans), если у менеджера нет активного плана.
const DEFAULT_PLAN = {
  calls_per_day: 15,
  interviews_per_day: 5,
  hires_per_month: 15,
};

/**
 * GET /api/dashboard/team
 * Сводный дашборд: KPI всех менеджеров за период vs план.
 * Роли: head, admin, executive. executive получает агрегаты без имён (EC-09).
 *
 * Данные читаются service-role клиентом (после requireRole), т.к. RLS не пускает
 * executive к daily_activities/user_profiles. Схему БД это не меняет.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const periodParsed = dashboardPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const period = periodParsed.data;
    const { from, to } = getPeriodRange(period);
    // period ∈ {today, week, month} — границы всегда заданы.
    const workdays = workdaysBetween(from as string, to as string);

    const db = createAdminClient();

    // Активные менеджеры.
    // Включаем уволенных: их историческая статистика и бейдж «Уволен» нужны в UI
    // (бизнес-правило EC-08). Фильтрация по `is_active` убрана.
    const { data: managers, error: managersError } = await db
      .from('user_profiles')
      .select('id, full_name, is_active')
      .eq('role', 'manager');
    if (managersError) throw new ApiError(500, 'DB_ERROR', managersError.message);
    const managerIds = (managers ?? []).map((m) => m.id);

    if (managerIds.length === 0) {
      return apiSuccess({
        data: { period, summary: emptySummary(), managers: [] },
      });
    }

    // «Выведено» считается всегда за полный текущий месяц через vacancies.closed_at,
    // независимо от селектора периода страницы — план найма у менеджера месячный.
    const month = currentMonthRange();

    // Параллельно: планы, активности за период, активные вакансии (без даты),
    // закрытые за текущий месяц (по vacancies.closed_at).
    const [plansRes, activitiesRes, vacanciesRes, closedRes] = await Promise.all([
      db
        .from('manager_plans')
        .select('manager_id, calls_per_day, interviews_per_day, hires_per_month, effective_from, created_at')
        .in('manager_id', managerIds)
        .lte('effective_from', to as string)
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false }),
      db
        .from('daily_activities')
        .select('manager_id, mango_calls_count, hh_calls_count, interviews_count')
        .in('manager_id', managerIds)
        .gte('activity_date', from as string)
        .lte('activity_date', to as string),
      db
        .from('vacancies')
        .select('manager_id')
        .eq('status', 'active')
        .in('manager_id', managerIds),
      db
        .from('vacancies')
        .select('manager_id')
        .eq('status', 'closed')
        .in('manager_id', managerIds)
        .gte('closed_at', month.from)
        .lte('closed_at', month.to),
    ]);

    if (plansRes.error) throw new ApiError(500, 'DB_ERROR', plansRes.error.message);
    if (activitiesRes.error) throw new ApiError(500, 'DB_ERROR', activitiesRes.error.message);
    if (vacanciesRes.error) throw new ApiError(500, 'DB_ERROR', vacanciesRes.error.message);
    if (closedRes.error) throw new ApiError(500, 'DB_ERROR', closedRes.error.message);

    // Активный план на менеджера: первый в порядке effective_from DESC, created_at DESC.
    const planByManager = new Map<string, { calls_per_day: number; interviews_per_day: number; hires_per_month: number }>();
    for (const p of plansRes.data ?? []) {
      if (!planByManager.has(p.manager_id)) {
        planByManager.set(p.manager_id, {
          calls_per_day: p.calls_per_day,
          interviews_per_day: p.interviews_per_day,
          hires_per_month: p.hires_per_month,
        });
      }
    }

    // Факты звонков/собеседований по менеджеру.
    const callsByManager = new Map<string, number>();
    const interviewsByManager = new Map<string, number>();
    for (const a of activitiesRes.data ?? []) {
      const calls = (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0);
      callsByManager.set(a.manager_id, (callsByManager.get(a.manager_id) ?? 0) + calls);
      interviewsByManager.set(
        a.manager_id,
        (interviewsByManager.get(a.manager_id) ?? 0) + (a.interviews_count ?? 0),
      );
    }

    // Активные вакансии по менеджеру.
    const activeVacByManager = new Map<string, number>();
    for (const v of vacanciesRes.data ?? []) {
      activeVacByManager.set(v.manager_id, (activeVacByManager.get(v.manager_id) ?? 0) + 1);
    }

    // Закрытые вакансии за текущий месяц по менеджеру (источник «Выведено»).
    const hiredByManager = new Map<string, number>();
    for (const v of closedRes.data ?? []) {
      hiredByManager.set(v.manager_id, (hiredByManager.get(v.manager_id) ?? 0) + 1);
    }

    // KPI на каждого менеджера.
    const managerKpis: ManagerKpi[] = (managers ?? []).map((m) => {
      const plan = planByManager.get(m.id) ?? DEFAULT_PLAN;

      const callsFact = callsByManager.get(m.id) ?? 0;
      const interviewsFact = interviewsByManager.get(m.id) ?? 0;
      const hiredFact = hiredByManager.get(m.id) ?? 0;

      const calls: KpiMetric = metric(callsFact, plan.calls_per_day * workdays);
      const interviews: KpiMetric = metric(interviewsFact, plan.interviews_per_day * workdays);
      // «Выведено» — всегда за текущий месяц целиком (closedRes уже отфильтрован
      // по month.from/month.to). План — hires_per_month без масштабирования.
      const hired: KpiMetric = metric(hiredFact, plan.hires_per_month);

      return {
        id: m.id,
        full_name: m.full_name,
        is_active: m.is_active,
        calls,
        interviews,
        hired,
        active_vacancies: activeVacByManager.get(m.id) ?? 0,
        status: calcManagerStatus(calls.pct, interviews.pct, hired.pct),
      };
    });

    // Сводка по отделу.
    const summary = {
      calls: sumMetric(managerKpis.map((k) => k.calls)),
      interviews: sumMetric(managerKpis.map((k) => k.interviews)),
      hired: sumMetric(managerKpis.map((k) => k.hired)),
      active_vacancies: managerKpis.reduce((s, k) => s + k.active_vacancies, 0),
    };

    // executive: обезличиваем строки менеджеров (без id и full_name, EC-09).
    const managersOut: ManagerKpi[] =
      user.role === 'executive'
        ? managerKpis.map((k) => ({
            calls: k.calls,
            interviews: k.interviews,
            hired: k.hired,
            active_vacancies: k.active_vacancies,
            status: k.status,
          }))
        : managerKpis;

    return apiSuccess({ data: { period, summary, managers: managersOut } });
  } catch (err) {
    return handleApiError(err);
  }
}

function metric(fact: number, plan: number): KpiMetric {
  return { fact, plan, pct: kpiPct(fact, plan) };
}

function sumMetric(metrics: KpiMetric[]): KpiMetric {
  const fact = metrics.reduce((s, m) => s + m.fact, 0);
  const plan = metrics.reduce((s, m) => s + m.plan, 0);
  return { fact, plan, pct: kpiPct(fact, plan) };
}

function emptySummary() {
  const zero: KpiMetric = { fact: 0, plan: 0, pct: 0 };
  return { calls: zero, interviews: zero, hired: zero, active_vacancies: 0 };
}
