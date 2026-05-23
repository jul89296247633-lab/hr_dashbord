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
 * PATCH /api/ai/insights/[id]/read — пометить инсайт прочитанным (head, admin).
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('INSIGHT_NOT_FOUND', 'Инсайт не найден', 404);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ai_insights')
      .update({ is_read: true })
      .eq('id', id)
      .select('id, is_read')
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('INSIGHT_NOT_FOUND', 'Инсайт не найден', 404);

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
