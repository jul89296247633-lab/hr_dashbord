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
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { aiGenerateSchema, type AiGenerateInput } from '@/lib/validations';
import { generateInsight } from '@/lib/ai/client';
import {
  buildAnomalyPrompt,
  buildForecastPrompt,
  buildRecommendationPrompt,
} from '@/lib/ai/prompts';
import { calcForecast } from '@/lib/ai/forecast';

const DEFAULT_PLAN = { calls_per_day: 15, interviews_per_day: 5, hires_per_month: 15 };

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

/**
 * POST /api/ai/insights/generate — генерация одного инсайта on-demand (head, admin).
 * Body: { type, manager_id?, vacancy_id? }. Rate-limit: 1 запрос / 2 часа на пользователя.
 * Anthropic claude-sonnet-4-5, max_tokens 1000. INSERT в ai_insights.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const body: unknown = await request.json();
    const parsed = aiGenerateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    const supabase = await createClient();

    // Rate limit: 1 on-demand запрос в 2 часа НА КОМПАНИЮ (CLAUDE.md §9 / review 4.5 🟠).
    // Считаем любой не-weekly_report инсайт от любого пользователя — порог общий
    // (head/admin/cron видят все строки ai_insights по RLS, так что count точен).
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { count: recent } = await supabase
      .from('ai_insights')
      .select('id', { count: 'exact', head: true })
      .neq('insight_type', 'weekly_report')
      .gte('created_at', twoHoursAgo);
    if ((recent ?? 0) > 0) {
      return apiError(
        'AI_RATE_LIMIT',
        'Следующий on-demand анализ доступен через 2 часа (лимит общий на компанию). Автоматический — каждую пятницу в 20:00.',
        429,
      );
    }

    const ctx =
      input.type === 'recommendation'
        ? await buildRecommendationContext(supabase, input)
        : await buildManagerContext(supabase, input);
    if ('error' in ctx) return apiError(ctx.error.code, ctx.error.message, ctx.error.status);

    const { result, tokensUsed } = await generateInsight(ctx.prompt, 1000);

    const { data: insight, error } = await supabase
      .from('ai_insights')
      .insert({
        insight_type: input.type,
        period_start: ctx.periodStart,
        period_end: ctx.periodEnd,
        manager_id: input.manager_id ?? null,
        vacancy_id: input.vacancy_id ?? null,
        severity: input.type === 'anomaly' ? (result.severity ?? null) : null,
        title: result.title.slice(0, 200),
        body_md: result.body_md,
        meta_json: ctx.meta,
        tokens_used: tokensUsed,
        triggered_by: user.id,
      })
      .select('*')
      .single();
    if (error || !insight) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось сохранить инсайт');
    }

    return apiSuccess({ data: insight });
  } catch (err) {
    return handleApiError(err);
  }
}

interface BuiltContext {
  prompt: string;
  periodStart: string;
  periodEnd: string;
  meta: Record<string, number | string | null>;
}
type ContextError = { error: { code: string; message: string; status: number } };

/** Контекст для anomaly/forecast (нужен manager_id). */
async function buildManagerContext(
  supabase: SupabaseServer,
  input: AiGenerateInput,
): Promise<BuiltContext | ContextError> {
  if (!input.manager_id) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Для этого типа нужен manager_id', status: 422 } };
  }

  const { data: manager } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .eq('id', input.manager_id)
    .maybeSingle();
  if (!manager) {
    return { error: { code: 'MANAGER_NOT_FOUND', message: 'Менеджер не найден', status: 404 } };
  }

  const plan = await activePlan(supabase, input.manager_id);

  if (input.type === 'forecast') {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const hiresFact = await countHires(supabase, input.manager_id, monthStart, monthEnd);
    const forecast = calcForecast({ hiresFact, hiresPlan: plan.hires_per_month, monthStart, monthEnd });

    return {
      prompt: buildForecastPrompt(manager.full_name, forecast),
      periodStart: monthStart,
      periodEnd: monthEnd,
      meta: {
        hires_fact: forecast.hires_fact,
        hires_plan: forecast.hires_plan,
        forecast_pct: forecast.forecast_pct,
        days_left: forecast.days_left,
      },
    };
  }

  // anomaly: текущая неделя + предыдущая для сравнения.
  const week = getPeriodRange('week');
  const from = week.from as string;
  const to = week.to as string;
  const workdays = workdaysBetween(from, to);

  const { data: acts } = await supabase
    .from('daily_activities')
    .select('activity_date, mango_calls_count, hh_calls_count, interviews_count')
    .eq('manager_id', input.manager_id)
    .gte('activity_date', from)
    .lte('activity_date', to);

  const callsFact = (acts ?? []).reduce((s, a) => s + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0), 0);
  const interviewsFact = (acts ?? []).reduce((s, a) => s + (a.interviews_count ?? 0), 0);
  const daysWithCalls = new Set(
    (acts ?? []).filter((a) => (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0) > 0).map((a) => a.activity_date),
  ).size;

  const callsPlan = plan.calls_per_day * workdays;
  const interviewsPlan = plan.interviews_per_day * workdays;

  // Предыдущая неделя — для prevCallsPct.
  const prevTo = shiftDate(from, -1);
  const prevFrom = shiftDate(from, -7);
  const { data: prevActs } = await supabase
    .from('daily_activities')
    .select('mango_calls_count, hh_calls_count')
    .eq('manager_id', input.manager_id)
    .gte('activity_date', prevFrom)
    .lte('activity_date', prevTo);
  const prevCalls = (prevActs ?? []).reduce((s, a) => s + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0), 0);
  const prevCallsPct = callsPlan > 0 ? kpiPct(prevCalls, callsPlan) : null;

  const { data: politeness } = await supabase
    .from('hh_manager_stats')
    .select('politeness_index')
    .eq('manager_id', input.manager_id)
    .eq('source_csv', 'politeness_managers')
    .order('stat_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const callsPct = kpiPct(callsFact, callsPlan);
  const interviewsPct = kpiPct(interviewsFact, interviewsPlan);
  const hiresFact = await countHires(supabase, input.manager_id, from, to);

  return {
    prompt: buildAnomalyPrompt({
      fullName: manager.full_name,
      periodStart: from,
      periodEnd: to,
      callsFact,
      callsPlan,
      callsPct,
      prevCallsPct,
      interviewsFact,
      interviewsPlan,
      interviewsPct,
      hiresFact,
      hiresPlan: plan.hires_per_month,
      politenessIndex: politeness?.politeness_index ?? null,
      zeroCallsDays: Math.max(workdays - daysWithCalls, 0),
    }),
    periodStart: from,
    periodEnd: to,
    meta: { calls_fact: callsFact, calls_plan: callsPlan, calls_pct: callsPct, prev_week_pct: prevCallsPct },
  };
}

/** Контекст для recommendation (нужен vacancy_id). */
async function buildRecommendationContext(
  supabase: SupabaseServer,
  input: AiGenerateInput,
): Promise<BuiltContext | ContextError> {
  if (!input.vacancy_id) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Для рекомендации нужен vacancy_id', status: 422 } };
  }

  const { data: vacancy } = await supabase
    .from('vacancies')
    .select('id, title, manager_id, opened_at')
    .eq('id', input.vacancy_id)
    .maybeSingle();
  if (!vacancy) {
    return { error: { code: 'VACANCY_NOT_FOUND', message: 'Вакансия не найдена', status: 404 } };
  }

  const { data: snapshot } = await supabase
    .from('vacancy_snapshots')
    .select('responses_count, contacts_opened, invitations_from_responses')
    .eq('vacancy_id', input.vacancy_id)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const fromDate = shiftDate(new Date().toISOString().slice(0, 10), -14);
  const { data: acts } = await supabase
    .from('daily_activities')
    .select('mango_calls_count, hh_calls_count')
    .eq('manager_id', vacancy.manager_id)
    .gte('activity_date', fromDate);
  const calls = (acts ?? []).reduce((s, a) => s + (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0), 0);

  const daysOpen = Math.max(
    Math.round((Date.now() - new Date(`${vacancy.opened_at}T00:00:00`).getTime()) / 86_400_000),
    0,
  );

  return {
    prompt: buildRecommendationPrompt({
      title: vacancy.title,
      responses: snapshot?.responses_count ?? 0,
      contactsOpened: snapshot?.contacts_opened ?? 0,
      invitationsSent: snapshot?.invitations_from_responses ?? 0,
      calls,
      daysOpen,
    }),
    periodStart: fromDate,
    periodEnd: new Date().toISOString().slice(0, 10),
    meta: {
      responses: snapshot?.responses_count ?? 0,
      contacts_opened: snapshot?.contacts_opened ?? 0,
      calls,
      days_open: daysOpen,
    },
  };
}

async function activePlan(supabase: SupabaseServer, managerId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('manager_plans')
    .select('calls_per_day, interviews_per_day, hires_per_month, effective_from, created_at')
    .eq('manager_id', managerId)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? DEFAULT_PLAN;
}

async function countHires(
  supabase: SupabaseServer,
  managerId: string,
  from: string,
  to: string,
): Promise<number> {
  const { data } = await supabase
    .from('hired_employees')
    .select('id, vacancy:vacancies!hired_employees_vacancy_id_fkey(manager_id)')
    .eq('employment_type', 'employee')
    .gte('hired_date', from)
    .lte('hired_date', to);
  return (data ?? []).filter((h) => h.vacancy?.manager_id === managerId).length;
}

/** Сдвиг даты YYYY-MM-DD на N дней. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
