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
 * GET /api/bonuses — список бонусов. manager видит только свои (RLS),
 * head/admin — все. Фильтры: manager_id (head/admin), status, year, month.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const sp = request.nextUrl.searchParams;
    const parsed = bonusesQuerySchema.safeParse({
      manager_id: sp.get('manager_id') ?? undefined,
      status: sp.get('status') ?? undefined,
      year: sp.get('year') ?? undefined,
      month: sp.get('month') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { manager_id, status, year, month, page, per_page } = parsed.data;

    if (manager_id) requireRole(user, ['head', 'admin']);

    const supabase = await createClient();
    const dateRange = monthRange(year, month);
    // Эффективный фильтр по менеджеру: явный (head/admin) либо собственный (manager).
    const effectiveManagerId = manager_id ?? (user.role === 'manager' ? user.id : null);

    // Страница результатов с эмбедами менеджера и вакансии.
    let listQuery = supabase
      .from('hr_bonuses')
      .select(
        'id, manager_id, vacancy_id, vacancy_title_sheet, bonus_amount_kopecks, bonus_date, status, manager:user_profiles!hr_bonuses_manager_id_fkey(id, full_name, is_active), vacancy:vacancies!hr_bonuses_vacancy_id_fkey(id, title)',
        { count: 'exact' },
      );
    if (effectiveManagerId) listQuery = listQuery.eq('manager_id', effectiveManagerId);
    if (status !== 'all') listQuery = listQuery.eq('status', status);
    if (dateRange) listQuery = listQuery.gte('bonus_date', dateRange.from).lte('bonus_date', dateRange.to);

    const from = (page - 1) * per_page;
    const { data, count, error } = await listQuery
      .order('bonus_date', { ascending: false })
      .range(from, from + per_page - 1);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Сумма по всем подходящим записям (не только текущая страница).
    let sumQuery = supabase.from('hr_bonuses').select('bonus_amount_kopecks');
    if (effectiveManagerId) sumQuery = sumQuery.eq('manager_id', effectiveManagerId);
    if (status !== 'all') sumQuery = sumQuery.eq('status', status);
    if (dateRange) sumQuery = sumQuery.gte('bonus_date', dateRange.from).lte('bonus_date', dateRange.to);
    const { data: sumRows, error: sumError } = await sumQuery;
    if (sumError) throw new ApiError(500, 'DB_ERROR', sumError.message);
    const totalAmountKopecks = (sumRows ?? []).reduce(
      (s, r) => s + (r.bonus_amount_kopecks ?? 0),
      0,
    );

    const rows = (data ?? []).map((b) => ({
      ...b,
      bonus_amount_display: formatKopecks(b.bonus_amount_kopecks),
      unmatched_note: b.vacancy_id ? undefined : 'Вакансия не сопоставлена — привяжите вручную',
    }));

    return apiSuccess({
      data: rows,
      total_amount_kopecks: totalAmountKopecks,
      total_amount_display: formatKopecks(totalAmountKopecks),
      meta: { total: count ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Копейки → «50 000 ₽». */
function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')} ₽`;
}

/** Диапазон дат по year/month. */
function monthRange(
  year?: number,
  month?: number,
): { from: string; to: string } | null {
  if (!year) return null;
  if (month) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
