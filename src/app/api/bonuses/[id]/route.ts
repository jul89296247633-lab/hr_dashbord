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
 * DELETE /api/bonuses/[id] — удаление бонуса (admin, для аудита).
 * Бонус остаётся в audit_logs. Используется при отмене закрытия вакансии.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Бонус не найден', 404);
    }

    const db = createAdminClient();
    const { error } = await db.from('hr_bonuses').delete().eq('id', id);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ message: 'Бонус удалён' });
  } catch (err) {
    return handleApiError(err);
  }
}
