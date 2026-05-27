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
import { uuidSchema } from '@/lib/validations';

/**
 * DELETE /api/staffing/plan/[id] — удалить плановую единицу. Роли: head, admin.
 * RLS staffing_plan_delete_head всё равно отсекает других, но requireRole
 * даёт более понятную ошибку (FORBIDDEN вместо «0 rows deleted»).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('STAFFING_PLAN_NOT_FOUND', 'Плановая единица не найдена', 404);
    }

    const supabase = await createClient();
    const { error, count } = await supabase
      .from('staffing_plan')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!count) {
      return apiError('STAFFING_PLAN_NOT_FOUND', 'Плановая единица не найдена', 404);
    }

    return apiSuccess({ data: { deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
}
