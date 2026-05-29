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
import { uuidSchema, vacancyRejectSchema } from '@/lib/validations';

/**
 * PATCH /api/vacancies/requests/[id]/reject
 * Отклонить заявку. Авторизация: head | admin | executive.
 * rejection_reason обязателен.
 * Отклонённая заявка остаётся видимой (status='draft', request_status='rejected').
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Заявка не найдена', 404);
    }

    const body: unknown = await request.json();
    const parsed = vacancyRejectSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { rejection_reason } = parsed.data;

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
      return apiError('INVALID_STATE', 'Только черновик можно отклонить', 409);
    }
    if (vacancy.requested_by === user.id) {
      return apiError('FORBIDDEN', 'Нельзя отклонить собственную заявку', 403);
    }

    const { data, error } = await supabase
      .from('vacancies')
      .update({
        request_status: 'rejected',
        rejection_reason,
        approved_by: null,
        approved_at: null,
      })
      .eq('id', id)
      .select('id, request_status, rejection_reason')
      .single();

    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось отклонить заявку');
    }

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
