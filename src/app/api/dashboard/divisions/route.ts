import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { divisionsPeriodSchema } from '@/lib/validations';

const NO_SUBDIVISION = 'Без подразделения';

interface FunnelMini {
  responses: number;
  contacts_opened: number;
  invitations_sent: number;
  hired: number;
  interns: number;
}

/**
 * GET /api/dashboard/divisions — аналитика по подразделениям (head, admin, executive).
 * По каждому subdivision: активные вакансии, закрыто за период, средний срок закрытия,
 * стажёры, агрегат воронки + список вакансий с мини-воронкой.
 *
 * Воронка агрегируется по данным, привязанным к ВАКАНСИИ (snapshots + hired_employees);
 * звонки/собеседования по менеджеру к подразделению не относятся (SPEC §5.3) и не включаются.
 * Все таблицы читаемы ролью executive по RLS — используется обычный клиент.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const periodParsed = divisionsPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const { from, to } = periodRange(periodParsed.data);
    const subdivisionFilter = request.nextUrl.searchParams.get('subdivision');

    const supabase = await createClient();

    let vacancyQuery = supabase
      .from('vacancies')
      .select(
        'id, title, subdivision, status, days_to_close, opened_at, closed_at, manager:user_profiles!vacancies_manager_id_fkey(id, full_name)',
      );
    if (subdivisionFilter) vacancyQuery = vacancyQuery.eq('subdivision', subdivisionFilter);
    const { data: vacancies, error: vacError } = await vacancyQuery;
    if (vacError) throw new ApiError(500, 'DB_ERROR', vacError.message);

    const vacancyIds = (vacancies ?? []).map((v) => v.id);
    if (vacancyIds.length === 0) {
      return apiSuccess({ data: { period: periodParsed.data, from, to, divisions: [] } });
    }

    // Последний snapshot на каждую вакансию.
    const { data: snapshots, error: snapError } = await supabase
      .from('vacancy_snapshots')
      .select('vacancy_id, responses_count, contacts_opened, invitations_sent, snapshot_at')
      .in('vacancy_id', vacancyIds)
      .order('snapshot_at', { ascending: false });
    if (snapError) throw new ApiError(500, 'DB_ERROR', snapError.message);

    const snapshotByVacancy = new Map<string, { responses: number; contacts: number; invitations: number }>();
    for (const s of snapshots ?? []) {
      if (!snapshotByVacancy.has(s.vacancy_id)) {
        snapshotByVacancy.set(s.vacancy_id, {
          responses: s.responses_count,
          contacts: s.contacts_opened,
          invitations: s.invitations_sent,
        });
      }
    }

    // Найм/стажёры по вакансиям за период.
    const { data: hired, error: hiredError } = await supabase
      .from('hired_employees')
      .select('vacancy_id, employment_type, hired_date')
      .in('vacancy_id', vacancyIds)
      .gte('hired_date', from)
      .lte('hired_date', to);
    if (hiredError) throw new ApiError(500, 'DB_ERROR', hiredError.message);

    const hiredByVacancy = new Map<string, number>();
    const internsByVacancy = new Map<string, number>();
    for (const h of hired ?? []) {
      if (!h.vacancy_id) continue;
      const target = h.employment_type === 'intern' ? internsByVacancy : hiredByVacancy;
      target.set(h.vacancy_id, (target.get(h.vacancy_id) ?? 0) + 1);
    }

    // Группировка по подразделению.
    const groups = new Map<string, typeof vacancies>();
    for (const v of vacancies ?? []) {
      const key = v.subdivision?.trim() || NO_SUBDIVISION;
      const arr = groups.get(key) ?? [];
      arr.push(v);
      groups.set(key, arr);
    }

    const today = new Date();
    const divisions = Array.from(groups.entries()).map(([subdivision, vacs]) => {
      const list = vacs ?? [];
      const closedInPeriod = list.filter(
        (v) => v.status === 'closed' && v.closed_at && v.closed_at >= from && v.closed_at <= to,
      );
      const closeDays = closedInPeriod
        .map((v) => v.days_to_close)
        .filter((d): d is number => typeof d === 'number');
      const avgDays =
        closeDays.length > 0
          ? Math.round(closeDays.reduce((s, d) => s + d, 0) / closeDays.length)
          : null;

      const funnel: FunnelMini = { responses: 0, contacts_opened: 0, invitations_sent: 0, hired: 0, interns: 0 };
      const vacancyDetails = list.map((v) => {
        const snap = snapshotByVacancy.get(v.id);
        const mini: FunnelMini = {
          responses: snap?.responses ?? 0,
          contacts_opened: snap?.contacts ?? 0,
          invitations_sent: snap?.invitations ?? 0,
          hired: hiredByVacancy.get(v.id) ?? 0,
          interns: internsByVacancy.get(v.id) ?? 0,
        };
        funnel.responses += mini.responses;
        funnel.contacts_opened += mini.contacts_opened;
        funnel.invitations_sent += mini.invitations_sent;
        funnel.hired += mini.hired;
        funnel.interns += mini.interns;

        return {
          id: v.id,
          title: v.title,
          manager: v.manager,
          status: v.status,
          days_open: daysSince(v.opened_at, today),
          funnel_mini: mini,
        };
      });

      return {
        subdivision,
        active_vacancies: list.filter((v) => v.status === 'active').length,
        closed_in_period: closedInPeriod.length,
        avg_days_to_close: avgDays,
        interns: funnel.interns,
        hired_in_period: funnel.hired,
        // План задаётся по менеджеру, а не по подразделению — агрегата нет.
        plan_completion_pct: null,
        funnel,
        vacancies: vacancyDetails,
      };
    });

    // Сортируем по числу активных вакансий по убыванию.
    divisions.sort((a, b) => b.active_vacancies - a.active_vacancies);

    return apiSuccess({ data: { period: periodParsed.data, from, to, divisions } });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Календарных дней с даты открытия. */
function daysSince(openedAt: string, today: Date): number {
  return Math.max(
    Math.round((today.getTime() - new Date(`${openedAt}T00:00:00`).getTime()) / 86_400_000),
    0,
  );
}

/** Диапазон периода [from, to=сегодня] для week|month|quarter. */
function periodRange(period: 'week' | 'month' | 'quarter'): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === 'week') {
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  } else if (period === 'month') {
    start.setMonth(today.getMonth(), 1);
  } else {
    start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
  }
  return { from: start.toISOString().slice(0, 10), to };
}
