import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
  getPeriodRange,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema, funnelPeriodSchema } from '@/lib/validations';
import type { FunnelStage, Period } from '@/types';

/**
 * GET /api/vacancies/[id]/funnel
 * Воронка по вакансии: responses → contacts_opened → invitations_from_responses →
 * calls → interviews → interns → hired. Конверсия = доля перехода в следующий этап.
 *
 * HH-этапы (responses/contacts/invitations) — из последнего vacancy_snapshots.
 * calls/interviews — по менеджеру вакансии за период (агрегат daily_activities).
 * interns — кандидаты на стажировке (hired_employees.status='probation') за период.
 * hired   — трудоустроенные (hired_employees.status='hired') за период.
 *
 * RLS: чужая вакансия для manager не видна → 404 (EC-07, без раскрытия факта).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getAuthUser();
    const { id } = await params;

    if (!uuidSchema.safeParse(id).success) {
      return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);
    }

    const periodParsed = funnelPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const period: Period = periodParsed.data;
    const { from, to } = getPeriodRange(period);

    const supabase = await createClient();

    // Вакансия (RLS ограничивает видимость).
    const { data: vacancy, error: vacancyError } = await supabase
      .from('vacancies')
      .select('id, title, manager_id')
      .eq('id', id)
      .maybeSingle();
    if (vacancyError) throw new ApiError(500, 'DB_ERROR', vacancyError.message);
    if (!vacancy) return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);

    // Последний снимок HH-воронки.
    const { data: snapshot, error: snapshotError } = await supabase
      .from('vacancy_snapshots')
      .select('responses_count, contacts_opened, invitations_from_responses, snapshot_at')
      .eq('vacancy_id', id)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshotError) throw new ApiError(500, 'DB_ERROR', snapshotError.message);

    // Звонки и собеседования — по менеджеру вакансии за период (SPEC §5.3).
    let activitiesQuery = supabase
      .from('daily_activities')
      .select('mango_calls_count, hh_calls_count, interviews_count')
      .eq('manager_id', vacancy.manager_id ?? '');
    if (from) activitiesQuery = activitiesQuery.gte('activity_date', from);
    if (to) activitiesQuery = activitiesQuery.lte('activity_date', to);
    const { data: activities, error: activitiesError } = await activitiesQuery;
    if (activitiesError) throw new ApiError(500, 'DB_ERROR', activitiesError.message);

    const calls = (activities ?? []).reduce(
      (sum, a) => sum + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0),
      0,
    );
    const interviews = (activities ?? []).reduce(
      (sum, a) => sum + (a.interviews_count ?? 0),
      0,
    );

    // Трудоустроенные (status='hired') по вакансии за период.
    let hiredQuery = supabase
      .from('hired_employees')
      .select('id', { count: 'exact', head: true })
      .eq('vacancy_id', id)
      .eq('status', 'hired');
    if (from) hiredQuery = hiredQuery.gte('hired_date', from);
    if (to) hiredQuery = hiredQuery.lte('hired_date', to);
    const { count: hiredCount, error: hiredError } = await hiredQuery;
    if (hiredError) throw new ApiError(500, 'DB_ERROR', hiredError.message);

    // Стажёры (status='probation') по вакансии за период.
    let internQuery = supabase
      .from('hired_employees')
      .select('id', { count: 'exact', head: true })
      .eq('vacancy_id', id)
      .eq('status', 'probation');
    if (from) internQuery = internQuery.gte('hired_date', from);
    if (to) internQuery = internQuery.lte('hired_date', to);
    const { count: internCount, error: internError } = await internQuery;
    if (internError) throw new ApiError(500, 'DB_ERROR', internError.message);

    // Этапы по порядку; conversion_pct[i] = count[i+1] / count[i].
    const counts: { stage: string; count: number }[] = [
      { stage: 'responses', count: snapshot?.responses_count ?? 0 },
      { stage: 'contacts_opened', count: snapshot?.contacts_opened ?? 0 },
      { stage: 'invitations_from_responses', count: snapshot?.invitations_from_responses ?? 0 },
      { stage: 'calls', count: calls },
      { stage: 'interviews', count: interviews },
      { stage: 'interns', count: internCount ?? 0 },
      { stage: 'hired', count: hiredCount ?? 0 },
    ];

    const funnel: FunnelStage[] = counts.map((cur, i) => {
      const next = counts[i + 1];
      const conversion_pct =
        next && cur.count > 0 ? Math.round((next.count / cur.count) * 1000) / 10 : null;
      return { stage: cur.stage, count: cur.count, conversion_pct };
    });

    return apiSuccess({
      data: {
        vacancy_id: vacancy.id,
        title: vacancy.title,
        period,
        funnel,
        last_synced_at: snapshot?.snapshot_at ?? null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
