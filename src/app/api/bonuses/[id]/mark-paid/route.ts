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
 * PATCH /api/bonuses/[id]/mark-paid — пометить бонус выплаченным (admin).
 * status='paid', paid_by=auth.uid(), paid_at=NOW().
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
      return apiError('NOT_FOUND', 'Бонус не найден', 404);
    }

    const db = createAdminClient();

    const { data: existing, error: fetchErr } = await db
      .from('hr_bonuses')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new ApiError(500, 'DB_ERROR', fetchErr.message);
    if (!existing) return apiError('NOT_FOUND', 'Бонус не найден', 404);
    if (existing.status !== 'pending') {
      return apiError('INVALID_STATE', 'Выплатить можно только бонус со статусом «pending»', 409);
    }

    const { data, error } = await db
      .from('hr_bonuses')
      .update({
        status: 'paid',
        paid_by: user.id,
        paid_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data, message: 'Бонус помечен как выплаченный' });
  } catch (err) {
    return handleApiError(err);
  }
}
