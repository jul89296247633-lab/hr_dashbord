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
import { uuidSchema, bonusRateUpdateSchema } from '@/lib/validations';
import { rublesToKopecks } from '@/lib/utils';

/**
 * PATCH /api/admin/bonus-rates/[id] — изменить тариф (admin).
 * Изменение тарифа НЕ пересчитывает ранее начисленные hr_bonuses
 * (matched_position_name и amount_kopecks зафиксированы в hr_bonuses снимком).
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
      return apiError('NOT_FOUND', 'Тариф не найден', 404);
    }

    const body: unknown = await request.json();
    const parsed = bonusRateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }

    const patch: {
      position_name?: string;
      amount_kopecks?: number;
      group_name?: string | null;
    } = {};
    if (parsed.data.position_name !== undefined) patch.position_name = parsed.data.position_name;
    if (parsed.data.amount_rubles !== undefined) {
      patch.amount_kopecks = rublesToKopecks(String(parsed.data.amount_rubles));
    }
    if (parsed.data.group_name !== undefined) patch.group_name = parsed.data.group_name;

    const db = createAdminClient();
    const { data, error } = await db
      .from('bonus_rates')
      .update(patch)
      .eq('id', id)
      .select('id, position_name, amount_kopecks, group_name, updated_at')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return apiError('DUPLICATE_POSITION', 'Тариф с таким названием уже существует', 409);
      }
      throw new ApiError(500, 'DB_ERROR', error.message);
    }
    if (!data) return apiError('NOT_FOUND', 'Тариф не найден', 404);

    return apiSuccess({ data, message: 'Тариф обновлён' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/admin/bonus-rates/[id] — удалить тариф (admin).
 * Старые hr_bonuses не затрагиваются: matched_position_name — snapshot, не FK.
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
      return apiError('NOT_FOUND', 'Тариф не найден', 404);
    }

    const db = createAdminClient();
    const { error } = await db.from('bonus_rates').delete().eq('id', id);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ message: 'Тариф удалён' });
  } catch (err) {
    return handleApiError(err);
  }
}
