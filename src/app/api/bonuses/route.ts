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
import { bonusesQuerySchema } from '@/lib/validations';

/**
 * GET /api/bonuses?status=all|pending|unmatched|paid&manager_id=&page=&per_page=
 *
 * Читает из hr_bonuses (записи, созданные триггером при закрытии вакансий).
 * manager видит только свои; head/admin — все; может фильтровать по manager_id.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const sp = request.nextUrl.searchParams;
    const parsed = bonusesQuerySchema.safeParse({
      status: sp.get('status') ?? undefined,
      manager_id: sp.get('manager_id') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { status, manager_id, page, per_page } = parsed.data;

    if (manager_id) requireRole(user, ['head', 'admin']);

    const effectiveManagerId =
      manager_id ?? (user.role === 'manager' ? user.id : undefined);

    const supabase = await createClient();

    let query = supabase
      .from('hr_bonuses')
      .select(
        `id, vacancy_id, manager_id, matched_position_name,
         bonus_amount_kopecks, bonus_date, status, source,
         matched_by, paid_by, paid_at, created_at, updated_at,
         vacancy:vacancies!hr_bonuses_vacancy_id_fkey(id, title, closed_at, subdivision, location),
         manager:user_profiles!hr_bonuses_manager_id_fkey(id, full_name, is_active)`,
        { count: 'exact' },
      )
      .order('bonus_date', { ascending: false });

    if (status !== 'all') query = query.eq('status', status);
    if (effectiveManagerId) query = query.eq('manager_id', effectiveManagerId);

    const from = (page - 1) * per_page;
    query = query.range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      vacancy_id: string;
      manager_id: string;
      matched_position_name: string | null;
      bonus_amount_kopecks: number | null;
      bonus_date: string;
      status: string;
      source: string;
      matched_by: string | null;
      paid_by: string | null;
      paid_at: string | null;
      created_at: string;
      updated_at: string;
      vacancy: { id: string; title: string; closed_at: string | null; subdivision: string | null; location: string | null } | null;
      manager: { id: string; full_name: string; is_active: boolean } | null;
    }>;

    const list = rows.map((r) => ({
      ...r,
      bonus_amount_display: r.bonus_amount_kopecks != null
        ? `${(r.bonus_amount_kopecks / 100).toLocaleString('ru-RU')} ₽`
        : null,
      manager: user.role === 'executive' ? null : r.manager,
    }));

    const totalKopecks = rows
      .filter((r) => r.status !== 'cancelled')
      .reduce((s, r) => s + (r.bonus_amount_kopecks ?? 0), 0);

    return apiSuccess({
      data: list,
      total_amount_kopecks: totalKopecks,
      total_amount_display: `${(totalKopecks / 100).toLocaleString('ru-RU')} ₽`,
      meta: { total: count ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
