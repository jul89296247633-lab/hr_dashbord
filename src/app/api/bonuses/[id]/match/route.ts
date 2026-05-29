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
import { uuidSchema, bonusMatchSchema } from '@/lib/validations';

/**
 * PATCH /api/bonuses/[id]/match
 *
 * Ручная привязка тарифа к бонусу со статусом 'unmatched' (head/admin).
 * Устанавливает matched_position_name, bonus_amount_kopecks,
 * status='pending', source='manual', matched_by=auth.uid().
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Бонус не найден', 404);
    }

    const body: unknown = await request.json();
    const parsed = bonusMatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }

    const db = createAdminClient();

    // Убеждаемся что бонус существует и в статусе unmatched
    const { data: existing, error: fetchErr } = await db
      .from('hr_bonuses')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new ApiError(500, 'DB_ERROR', fetchErr.message);
    if (!existing) return apiError('NOT_FOUND', 'Бонус не найден', 404);
    if (existing.status !== 'unmatched') {
      return apiError('INVALID_STATE', 'Привязать тариф можно только к бонусу со статусом «unmatched»', 409);
    }

    const { data, error } = await db
      .from('hr_bonuses')
      .update({
        matched_position_name: parsed.data.matched_position_name,
        bonus_amount_kopecks: parsed.data.bonus_amount_kopecks,
        status: 'pending',
        source: 'manual',
        matched_by: user.id,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data, message: 'Тариф привязан' });
  } catch (err) {
    return handleApiError(err);
  }
}
