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
import { hhConnectSchema, uuidSchema } from '@/lib/validations';

/**
 * POST /api/admin/integrations/hh/[manager_id]/connect — сохранить HH OAuth-токены менеджера
 * (только admin). Принимает access_token (+ refresh_token, hh_manager_id, expires_at|expires_in).
 * Запись токенов — service-role.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ manager_id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { manager_id } = await params;
    if (!uuidSchema.safeParse(manager_id).success) {
      return apiError('USER_NOT_FOUND', 'Менеджер не найден', 404);
    }

    const body: unknown = await request.json();
    const parsed = hhConnectSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    // Срок действия: явный expires_at, либо expires_in (сек) от текущего момента.
    const expiresAt =
      input.expires_at ??
      (input.expires_in ? new Date(Date.now() + input.expires_in * 1000).toISOString() : null);

    const db = createAdminClient();
    const { data, error } = await db
      .from('user_profiles')
      .update({
        hh_access_token: input.access_token,
        hh_refresh_token: input.refresh_token ?? null,
        hh_token_expires_at: expiresAt,
        ...(input.hh_manager_id !== undefined ? { hh_manager_id: input.hh_manager_id } : {}),
      })
      .eq('id', manager_id)
      .select('id, full_name, hh_manager_id, hh_token_expires_at')
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('USER_NOT_FOUND', 'Менеджер не найден', 404);

    return apiSuccess({
      data: { ...data, hh_connected: true },
      message: 'HH-токен сохранён',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
