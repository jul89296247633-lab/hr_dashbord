import {
  getAuthUser,
  requireRole,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/staffing/plan/options — автоподсказки для формы добавления плана.
 *  • cities    = DISTINCT vacancies.location (точное написание для матчинга)
 *  • positions = bonus_rates.position_name (единая номенклатура должностей)
 *
 * Используется только в StaffingPlanRowForm (head/admin). Executive
 * видит таблицу read-only, ему опции не нужны.
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const supabase = await createClient();

    const [citiesRes, positionsRes] = await Promise.all([
      supabase
        .from('vacancies')
        .select('location')
        .not('location', 'is', null)
        .order('location'),
      supabase
        .from('bonus_rates')
        .select('position_name')
        .order('position_name'),
    ]);

    if (citiesRes.error) throw new ApiError(500, 'DB_ERROR', citiesRes.error.message);
    if (positionsRes.error) throw new ApiError(500, 'DB_ERROR', positionsRes.error.message);

    // DISTINCT на клиенте — supabase-js не умеет .distinct() напрямую.
    const cities = Array.from(
      new Set((citiesRes.data ?? []).map((r) => (r.location ?? '').trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, 'ru'));

    const positions = (positionsRes.data ?? [])
      .map((r) => r.position_name)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);

    return apiSuccess({ data: { cities, positions } });
  } catch (err) {
    return handleApiError(err);
  }
}
