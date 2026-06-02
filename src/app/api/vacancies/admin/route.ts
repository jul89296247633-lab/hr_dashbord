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
import { vacancyAdminQuerySchema } from '@/lib/validations';

/**
 * GET /api/vacancies/admin — широкая таблица всех вакансий для head/admin/executive.
 *
 * Включает все статусы (active/paused/closed/draft), все типы (open/confidential).
 * EC-6: executive получает vacancy без поля manager (null).
 * Поддерживает фильтры: status, type (confidentiality), city, manager_id, search.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const sp = request.nextUrl.searchParams;
    const parsed = vacancyAdminQuerySchema.safeParse({
      status: sp.get('status') ?? undefined,
      type: sp.get('type') ?? undefined,
      city: sp.get('city') ?? undefined,
      subdivision: sp.get('subdivision') ?? undefined,
      manager_id: sp.get('manager_id') ?? undefined,
      search: sp.get('search') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { status, type, city, subdivision, manager_id, search, page, per_page } = parsed.data;

    const db = createAdminClient();

    let query = db
      .from('vacancies')
      .select(
        `id, hh_vacancy_id, internal_ref, title, subdivision, location,
         manager_id, status, confidentiality, request_status,
         opened_at, closed_at, days_to_close, staffing_plan_id,
         google_sheet_row, priority, customer_name, positions_count,
         appearance_reason, explanation, candidate_name, comment,
         created_at, updated_at,
         manager:user_profiles!vacancies_manager_id_fkey(id, full_name, is_active)`,
        { count: 'exact' },
      )
      .order('opened_at', { ascending: false });

    if (status !== 'all') query = query.eq('status', status);
    if (type !== 'all') query = query.eq('confidentiality', type);
    if (city) query = query.ilike('location', `%${city}%`);
    if (subdivision) query = query.eq('subdivision', subdivision);
    if (manager_id) query = query.eq('manager_id', manager_id);
    if (search) query = query.ilike('title', `%${search}%`);

    const from = (page - 1) * per_page;
    query = query.range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      hh_vacancy_id: string | null;
      internal_ref: string | null;
      title: string;
      subdivision: string | null;
      location: string | null;
      manager_id: string | null;
      status: string;
      confidentiality: string;
      request_status: string | null;
      opened_at: string;
      closed_at: string | null;
      days_to_close: number | null;
      staffing_plan_id: string | null;
      google_sheet_row: number | null;
      priority: string | null;
      customer_name: string | null;
      positions_count: number | null;
      appearance_reason: string | null;
      explanation: string | null;
      candidate_name: string | null;
      comment: string | null;
      created_at: string;
      updated_at: string;
      manager: { id: string; full_name: string; is_active: boolean } | null;
    }>;

    // EC-6: executive не видит данные менеджера
    const responseRows = rows.map((v) => ({
      ...v,
      manager: user.role === 'executive' ? null : v.manager,
      manager_id: user.role === 'executive' ? null : v.manager_id,
    }));

    return apiSuccess({
      data: responseRows,
      meta: { total: count ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
