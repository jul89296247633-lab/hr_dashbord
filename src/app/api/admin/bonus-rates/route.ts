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
import { createAdminClient } from '@/lib/supabase/admin';
import { bonusRateCreateSchema } from '@/lib/validations';
import { rublesToKopecks } from '@/lib/utils';

/**
 * GET /api/admin/bonus-rates — список тарифов (head/admin).
 * Сортировка: group_name ASC, position_name ASC.
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('bonus_rates')
      .select('id, position_name, amount_kopecks, group_name, created_at, updated_at')
      .order('group_name', { ascending: true, nullsFirst: true })
      .order('position_name', { ascending: true });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const list = (data ?? []).map((r) => ({
      ...r,
      amount_display: `${(r.amount_kopecks / 100).toLocaleString('ru-RU')} ₽`,
    }));

    return apiSuccess({ data: list });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/admin/bonus-rates — создать тариф (admin).
 * amount_rubles → kopecks через rublesToKopecks из lib/utils.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const body: unknown = await request.json();
    const parsed = bonusRateCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { position_name, amount_rubles, group_name } = parsed.data;

    const db = createAdminClient();
    const { data, error } = await db
      .from('bonus_rates')
      .insert({
        position_name,
        amount_kopecks: rublesToKopecks(String(amount_rubles)),
        group_name: group_name ?? null,
      })
      .select('id, position_name, amount_kopecks, group_name, created_at, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        return apiError('DUPLICATE_POSITION', 'Тариф с таким названием уже существует', 409);
      }
      throw new ApiError(500, 'DB_ERROR', error.message);
    }

    return apiSuccess({ data, message: 'Тариф добавлен' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
