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
 * DELETE /api/admin/integrations/hh/[manager_id] — отозвать HH-токены менеджера (только admin).
 * Очищает access/refresh токены и срок действия. Запись — service-role.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ manager_id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { manager_id } = await params;
    if (!uuidSchema.safeParse(manager_id).success) {
      return apiError('USER_NOT_FOUND', 'Менеджер не найден', 404);
    }

    const db = createAdminClient();
    const { data, error } = await db
      .from('user_profiles')
      .update({
        hh_access_token: null,
        hh_refresh_token: null,
        hh_token_expires_at: null,
      })
      .eq('id', manager_id)
      .select('id, full_name')
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('USER_NOT_FOUND', 'Менеджер не найден', 404);

    return apiSuccess({ data: { ...data, hh_connected: false }, message: 'HH-токен отозван' });
  } catch (err) {
    return handleApiError(err);
  }
}
