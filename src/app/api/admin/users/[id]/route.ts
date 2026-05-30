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
import { adminUserUpdateSchema, uuidSchema } from '@/lib/validations';

/**
 * PATCH /api/admin/users/[id] — обновление профиля пользователя (только admin).
 * Поля: full_name?, role?, is_active?, mango_extension?.
 *
 * Защиты (review 4.5 🟠 admin self-deactivate):
 *  - admin не может сам себя деактивировать или разжаловать;
 *  - запрещено разжалование / деактивация последнего активного admin
 *    (иначе админка станет недоступна никому).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('USER_NOT_FOUND', 'Пользователь не найден', 404);
    }

    const body: unknown = await request.json();
    const parsed = adminUserUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const patch = parsed.data;

    // Защита 1: admin не может «выключить» себя.
    if (id === user.id) {
      if (patch.is_active === false) {
        return apiError(
          'CANNOT_DEACTIVATE_SELF',
          'Нельзя деактивировать собственную учётную запись',
          409,
        );
      }
      if (patch.role !== undefined && patch.role !== 'admin') {
        return apiError(
          'CANNOT_DEMOTE_SELF',
          'Нельзя сменить собственную роль администратора',
          409,
        );
      }
    }

    const supabase = await createClient();

    // Защита 2: нельзя оставить систему без активных админов.
    // Срабатывает только если правка действительно «снимает» админство с цели.
    const wouldRemoveAdmin = patch.is_active === false || (patch.role !== undefined && patch.role !== 'admin');
    if (wouldRemoveAdmin) {
      const { data: target, error: targetError } = await supabase
        .from('user_profiles')
        .select('id, role, is_active')
        .eq('id', id)
        .maybeSingle();
      if (targetError) throw new ApiError(500, 'DB_ERROR', targetError.message);
      if (!target) return apiError('USER_NOT_FOUND', 'Пользователь не найден', 404);

      // Цель сейчас активный admin → проверяем, есть ли другие активные админы.
      if (target.role === 'admin' && target.is_active) {
        const { count, error: countError } = await supabase
          .from('user_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true)
          .neq('id', id);
        if (countError) throw new ApiError(500, 'DB_ERROR', countError.message);
        if ((count ?? 0) < 1) {
          return apiError(
            'LAST_ACTIVE_ADMIN',
            'Это последний активный администратор — сначала назначьте другого.',
            409,
          );
        }
      }
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(patch)
      .eq('id', id)
      .select('id, full_name, role, is_active, mango_extension, updated_at')
      .maybeSingle();
    if (error) {
      // 23505 = unique_violation: добавочный номер Mango уже занят другим менеджером
      if (error.code === '23505' && error.message.includes('mango_ext')) {
        return apiError(
          'MANGO_EXTENSION_TAKEN',
          `Добавочный номер ${patch.mango_extension ?? ''} уже используется другим менеджером`,
          409,
        );
      }
      throw new ApiError(500, 'DB_ERROR', error.message);
    }
    if (!data) return apiError('USER_NOT_FOUND', 'Пользователь не найден', 404);

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
