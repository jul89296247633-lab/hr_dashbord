import {
  getAuthUser,
  requireRole,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/admin/users — список всех пользователей (только admin).
 * Читается service-role клиентом. hh-токен наружу не отдаём — только статус подключения.
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const db = createAdminClient();
    const { data, error } = await db
      .from('user_profiles')
      .select(
        'id, full_name, email, role, is_active, mango_extension, hh_manager_id, hh_access_token, hh_token_expires_at, created_at',
      )
      .order('created_at', { ascending: false });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Не раскрываем сам токен — только факт подключения и срок действия.
    const users = (data ?? []).map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: u.is_active,
      mango_extension: u.mango_extension,
      hh_manager_id: u.hh_manager_id,
      hh_connected: Boolean(u.hh_access_token),
      hh_token_expires_at: u.hh_token_expires_at,
      created_at: u.created_at,
    }));

    return apiSuccess({ data: users });
  } catch (err) {
    return handleApiError(err);
  }
}
