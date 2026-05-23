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
import { uuidSchema } from '@/lib/validations';

/**
 * GET /api/plans/[manager_id] — активный план менеджера (последний effective_from ≤ сегодня).
 * manager — только свой; head/admin — любой.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ manager_id: string }> },
) {
  try {
    const user = await getAuthUser();
    const { manager_id } = await params;

    if (!uuidSchema.safeParse(manager_id).success) {
      return apiError('PLAN_NOT_FOUND', 'Активный план для данного менеджера не найден', 404);
    }
    if (manager_id !== user.id) {
      requireRole(user, ['head', 'admin']);
    }

    const today = new Date().toISOString().slice(0, 10);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('manager_plans')
      .select(
        'id, manager_id, effective_from, calls_per_day, interviews_per_day, vacancies_limit, hires_per_month, created_at, set_by_user:user_profiles!manager_plans_set_by_fkey(id, full_name)',
      )
      .eq('manager_id', manager_id)
      .lte('effective_from', today)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) {
      return apiError('PLAN_NOT_FOUND', 'Активный план для данного менеджера не найден', 404);
    }

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
