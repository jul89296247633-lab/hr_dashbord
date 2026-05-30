import { cookies } from 'next/headers';
import {
  getAuthContext,
  apiSuccess,
  handleApiError,
  IMPERSONATE_COOKIE,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/admin/impersonate/stop
 *
 * Завершает активную impersonation-сессию текущего пользователя:
 * проставляет ended_at='manual' и гасит cookie. Overlay прекращается немедленно
 * (server-authoritative). См. FEATURE_SPEC_impersonation.md.
 */
export async function POST() {
  try {
    const { realUser } = await getAuthContext();

    const db = createAdminClient();
    await db
      .from('impersonation_logs')
      .update({ ended_at: new Date().toISOString(), end_reason: 'manual' })
      .eq('impersonator_id', realUser.id)
      .is('ended_at', null);

    const jar = await cookies();
    jar.delete(IMPERSONATE_COOKIE);

    return apiSuccess({ data: { ok: true } });
  } catch (err) {
    return handleApiError(err);
  }
}
