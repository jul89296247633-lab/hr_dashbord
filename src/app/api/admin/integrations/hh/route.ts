import {
  getAuthUser,
  requireRole,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

type TokenStatus = 'active' | 'expiring' | 'expired' | 'none';

const EXPIRING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня

/**
 * GET /api/admin/integrations/hh — статус HH OAuth-токенов менеджеров (только admin).
 * Сами токены наружу не отдаются — только статус и срок действия.
 * Читается service-role клиентом.
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const db = createAdminClient();
    const { data, error } = await db
      .from('user_profiles')
      .select('id, full_name, hh_manager_id, hh_access_token, hh_token_expires_at')
      .eq('role', 'manager')
      .order('full_name', { ascending: true });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const now = Date.now();
    const managers = (data ?? []).map((m) => ({
      manager_id: m.id,
      full_name: m.full_name,
      hh_manager_id: m.hh_manager_id,
      status: tokenStatus(Boolean(m.hh_access_token), m.hh_token_expires_at, now),
      expires_at: m.hh_token_expires_at,
    }));

    return apiSuccess({ data: managers });
  } catch (err) {
    return handleApiError(err);
  }
}

function tokenStatus(hasToken: boolean, expiresAt: string | null, now: number): TokenStatus {
  if (!hasToken) return 'none';
  if (!expiresAt) return 'active';
  const exp = new Date(expiresAt).getTime();
  if (exp <= now) return 'expired';
  if (exp - now <= EXPIRING_WINDOW_MS) return 'expiring';
  return 'active';
}
