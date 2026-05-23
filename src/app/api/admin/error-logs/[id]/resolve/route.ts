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
 * PATCH /api/admin/error-logs/[id]/resolve — пометить ошибку изученной (только admin).
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('ERROR_LOG_NOT_FOUND', 'Запись лога не найдена', 404);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('error_logs')
      .update({ resolved: true, resolved_by: user.id, resolved_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, resolved, resolved_by, resolved_at')
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('ERROR_LOG_NOT_FOUND', 'Запись лога не найдена', 404);

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
