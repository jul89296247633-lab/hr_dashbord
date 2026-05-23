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
import { staffingCreateSchema } from '@/lib/validations';

const HISTORY_LIMIT = 20;

/**
 * GET /api/staffing
 * Текущий % укомплектованности + история последних 20 записей. Любая роль.
 */
export async function GET() {
  try {
    await getAuthUser();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('staffing_records')
      .select(
        'id, staffing_pct, comment, recorded_at, recorded_by:user_profiles!staffing_records_recorded_by_fkey(id, full_name)',
      )
      .order('recorded_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const history = data ?? [];
    return apiSuccess({
      data: {
        current: history[0] ?? null,
        history,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/staffing
 * Добавляет запись % укомплектованности (INSERT, история). Роли: head, admin.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const body: unknown = await request.json();
    const parsed = staffingCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('staffing_records')
      .insert({
        staffing_pct: input.staffing_pct,
        comment: input.comment ?? null,
        recorded_by: user.id,
      })
      .select(
        'id, staffing_pct, comment, recorded_at, recorded_by:user_profiles!staffing_records_recorded_by_fkey(id, full_name)',
      )
      .single();
    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось сохранить запись');
    }

    return apiSuccess({
      data,
      message: `Укомплектованность обновлена: ${input.staffing_pct}%`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
