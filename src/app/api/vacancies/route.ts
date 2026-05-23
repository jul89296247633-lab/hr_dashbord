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
import { vacancyListQuerySchema, vacancyCreateSchema } from '@/lib/validations';
import type { VacancyListItem } from '@/types';

/**
 * GET /api/vacancies
 * Список вакансий. manager видит только свои (RLS + явный фильтр).
 * head/admin/executive — все; могут фильтровать по ?manager_id.
 * executive не получает manager_id/manager в ответе (EC-09).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const sp = request.nextUrl.searchParams;
    const parsed = vacancyListQuerySchema.safeParse({
      status: sp.get('status') ?? undefined,
      manager_id: sp.get('manager_id') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { status, manager_id, page, per_page } = parsed.data;

    const supabase = await createClient();
    let query = supabase
      .from('vacancies')
      .select(
        'id, hh_vacancy_id, title, department, subdivision, location, manager_id, status, opened_at, closed_at, days_to_close, google_sheet_row, created_at, updated_at, manager:user_profiles!vacancies_manager_id_fkey(id, full_name, is_active)',
        { count: 'exact' },
      );

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Фильтр по чужому менеджеру доступен только привилегированным ролям.
    if (manager_id) {
      requireRole(user, ['head', 'admin', 'executive']);
      query = query.eq('manager_id', manager_id);
    }

    // manager видит только свои (RLS уже ограничивает, но фильтруем явно).
    if (user.role === 'manager') {
      query = query.eq('manager_id', user.id);
    }

    const from = (page - 1) * per_page;
    query = query.order('opened_at', { ascending: false }).range(from, from + per_page - 1);

    const { data, count, error } = await query.returns<VacancyListItem[]>();
    if (error) {
      throw new ApiError(500, 'DB_ERROR', error.message);
    }

    const rows = data ?? [];

    // executive: убираем имена/идентификаторы менеджеров (read-only без персоналий, EC-09).
    const responseRows =
      user.role === 'executive'
        ? rows.map((v) => ({
            id: v.id,
            hh_vacancy_id: v.hh_vacancy_id,
            title: v.title,
            department: v.department,
            subdivision: v.subdivision,
            location: v.location,
            status: v.status,
            opened_at: v.opened_at,
            closed_at: v.closed_at,
            days_to_close: v.days_to_close,
            google_sheet_row: v.google_sheet_row,
            created_at: v.created_at,
            updated_at: v.updated_at,
          }))
        : rows;

    return apiSuccess({
      data: responseRows,
      total: count ?? 0,
      page,
      per_page,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/vacancies — создание вакансии (head, admin).
 * opened_at по умолчанию — сегодня. RLS vacancies_write пускает только head/admin.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const body: unknown = await request.json();
    const parsed = vacancyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('vacancies')
      .insert({
        title: input.title,
        department: input.department ?? null,
        subdivision: input.subdivision ?? null,
        manager_id: input.manager_id,
        hh_vacancy_id: input.hh_vacancy_id ?? null,
        opened_at: input.opened_at ?? new Date().toISOString().slice(0, 10),
        status: input.status,
      })
      .select('*')
      .single();
    if (error || !data) {
      // 23505 — нарушение UNIQUE (hh_vacancy_id уже привязан).
      if (error?.code === '23505') {
        return apiError('HH_VACANCY_ID_EXISTS', 'Вакансия с таким HH ID уже существует', 409);
      }
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось создать вакансию');
    }

    return apiSuccess({ data, message: 'Вакансия создана' }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
