import { type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import {
  getAuthContext,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
  IMPERSONATE_COOKIE,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

/**
 * POST /api/admin/impersonate { manager_id }
 *
 * Запускает impersonation (overlay, read-only). Доступ: admin/head.
 * Цель — только role='manager'. Связку nonce->manager_id (запись сессии) храним
 * в impersonation_logs (server-authoritative), id строки кладём в httpOnly-cookie.
 * См. FEATURE_SPEC_impersonation.md.
 */
export async function POST(request: NextRequest) {
  try {
    const { realUser } = await getAuthContext();
    requireRole(realUser, ['admin', 'head']);

    const body: unknown = await request.json().catch(() => null);
    const managerId =
      body && typeof body === 'object' && 'manager_id' in body
        ? (body as { manager_id?: unknown }).manager_id
        : undefined;
    if (typeof managerId !== 'string' || !uuidSchema.safeParse(managerId).success) {
      return apiError('VALIDATION_ERROR', 'manager_id обязателен и должен быть UUID', 422);
    }

    const db = createAdminClient();

    // Цель должна существовать, быть активной и иметь role='manager' (нельзя impersonate вверх/вбок).
    const { data: target } = await db
      .from('user_profiles')
      .select('id, role, is_active')
      .eq('id', managerId)
      .maybeSingle();
    if (!target) {
      return apiError('NOT_FOUND', 'Пользователь не найден', 404);
    }
    if (target.role !== 'manager') {
      return apiError('FORBIDDEN', 'Impersonation доступна только для роли «менеджер»', 403);
    }
    if (!target.is_active) {
      return apiError('VALIDATION_ERROR', 'Менеджер деактивирован', 422);
    }

    // Закрываем брошенные активные сессии этого impersonator'а (одна активная на admin/head).
    await db
      .from('impersonation_logs')
      .update({ ended_at: new Date().toISOString(), end_reason: 'expired' })
      .eq('impersonator_id', realUser.id)
      .is('ended_at', null);

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = request.headers.get('user-agent')?.slice(0, 500) ?? null;

    const { data: row, error } = await db
      .from('impersonation_logs')
      .insert({
        impersonator_id: realUser.id,
        impersonator_role: realUser.role,
        target_manager_id: managerId,
        ip_address: ip,
        user_agent: ua,
      })
      .select('id')
      .single();
    if (error || !row) {
      return handleApiError(new ApiError(500, 'DB_ERROR', error?.message ?? 'impersonation_logs insert failed'));
    }

    const jar = await cookies();
    jar.set(IMPERSONATE_COOKIE, row.id, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600, // 1 час = TTL сессии
    });

    return apiSuccess({ data: { ok: true, impersonating: managerId } });
  } catch (err) {
    return handleApiError(err);
  }
}
