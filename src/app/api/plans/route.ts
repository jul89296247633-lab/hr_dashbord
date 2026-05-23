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
import { planCreateSchema } from '@/lib/validations';

/**
 * GET /api/plans
 * Активный план каждого менеджера (последний по effective_from ≤ сегодня,
 * затем по created_at). head/admin — все; manager — только свой.
 */
export async function GET() {
  try {
    const user = await getAuthUser();

    const today = new Date().toISOString().slice(0, 10);
    const supabase = await createClient();

    let query = supabase
      .from('manager_plans')
      .select(
        'id, manager_id, effective_from, calls_per_day, interviews_per_day, hires_per_month, vacancies_limit, set_by, created_at, manager:user_profiles!manager_plans_manager_id_fkey(id, full_name)',
      )
      .lte('effective_from', today)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false });

    // manager видит только свой план (RLS уже ограничивает, фильтруем явно).
    if (user.role === 'manager') {
      query = query.eq('manager_id', user.id);
    } else {
      requireRole(user, ['head', 'admin', 'manager']);
    }

    const { data, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Оставляем по одному (последнему) плану на менеджера.
    const seen = new Set<string>();
    const activePlans = (data ?? []).filter((p) => {
      if (seen.has(p.manager_id)) return false;
      seen.add(p.manager_id);
      return true;
    });

    return apiSuccess({ data: activePlans });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/plans
 * Создаёт новый план (INSERT, история сохраняется — EC-05). Роли: head, admin.
 * effective_from по умолчанию — 1-е число следующего месяца.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const body: unknown = await request.json();
    const parsed = planCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;
    const effectiveFrom = input.effective_from ?? firstOfNextMonth();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('manager_plans')
      .insert({
        manager_id: input.manager_id,
        effective_from: effectiveFrom,
        calls_per_day: input.calls_per_day,
        interviews_per_day: input.interviews_per_day,
        hires_per_month: input.hires_per_month,
        vacancies_limit: input.vacancies_limit,
        set_by: user.id,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось сохранить план');
    }

    return apiSuccess({
      data,
      message: `План обновлён с ${effectiveFrom}`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** 1-е число следующего месяца в формате YYYY-MM-DD. */
function firstOfNextMonth(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}
