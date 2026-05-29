import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

/**
 * GET /api/admin/bonus-rates/[id]/history — история изменений тарифа (admin).
 * Читает из audit_logs WHERE table_name='bonus_rates' AND record_id=[id].
 * Аудит-триггер bonus_rates фиксирует только изменившиеся поля (diff-стиль).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Тариф не найден', 404);
    }

    const db = createAdminClient();
    const { data, error } = await db
      .from('audit_logs')
      .select(
        `id, action, old_values, new_values, created_at,
         user:user_profiles!audit_logs_user_id_fkey(id, full_name, role)`,
      )
      .eq('table_name', 'bonus_rates')
      .eq('record_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data: data ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}
