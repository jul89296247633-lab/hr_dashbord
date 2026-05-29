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
 * PATCH /api/vacancies/requests/[id]/approve
 * Согласовать заявку. Авторизация: head | admin | executive.
 *
 * Edge cases:
 *   - Нельзя согласовать свою заявку (requested_by = auth.uid() → 403).
 *   - Повторное согласование → идемпотентно: возвращает текущее состояние, 200.
 *   - Согласование уже отклонённой → 409.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Заявка не найдена', 404);
    }

    const supabase = await createClient();

    const { data: vacancy, error: fetchError } = await supabase
      .from('vacancies')
      .select('id, status, request_status, requested_by')
      .eq('id', id)
      .single();

    if (fetchError || !vacancy) {
      return apiError('NOT_FOUND', 'Заявка не найдена', 404);
    }
    if (vacancy.status !== 'draft') {
      return apiError('INVALID_STATE', 'Только черновик можно согласовать', 409);
    }
    if (vacancy.requested_by === user.id) {
      return apiError('FORBIDDEN', 'Нельзя согласовать собственную заявку', 403);
    }
    if (vacancy.request_status === 'rejected') {
      return apiError('INVALID_STATE', 'Нельзя согласовать отклонённую заявку', 409);
    }
    // Идемпотентность: уже approved → 200 с текущим состоянием.
    if (vacancy.request_status === 'approved') {
      return apiSuccess({ data: { id: vacancy.id, request_status: 'approved' } });
    }

    const { data, error } = await supabase
      .from('vacancies')
      .update({
        request_status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', id)
      .select('id, request_status, approved_by, approved_at')
      .single();

    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось согласовать заявку');
    }

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
