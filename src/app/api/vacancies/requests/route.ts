import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { vacancyRequestCreateSchema } from '@/lib/validations';

/**
 * GET /api/vacancies/requests
 * Список заявок (status='draft'). Фильтр по ?request_status=pending|approved|rejected.
 * manager видит только свои (RLS + явный фильтр); head/admin/executive — все.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    const sp = request.nextUrl.searchParams;
    const requestStatus = sp.get('request_status') ?? undefined;

    const supabase = await createClient();
    let query = supabase
      .from('vacancies')
      .select(
        'id, title, location, subdivision, confidentiality, status, request_status, request_reason, requested_by, approved_by, approved_at, rejection_reason, opened_at, created_at, manager_id, positions_count, manager:user_profiles!vacancies_manager_id_fkey(id, full_name)',
        { count: 'exact' },
      )
      .eq('status', 'draft')
      .order('created_at', { ascending: false });

    if (requestStatus) {
      query = query.eq('request_status', requestStatus);
    }

    if (user.role === 'manager') {
      query = query.eq('requested_by', user.id);
    }

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data: data ?? [], total: count ?? 0 });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/vacancies/requests
 * Создать заявку на вакансию. Доступно любому авторизованному пользователю.
 *
 * Создаётся vacancies запись со status='draft', request_status='pending',
 * requested_by=auth.uid(). RLS vacancies_request_insert пропускает INSERT
 * только с этими значениями — дополнительная защита на уровне БД.
 *
 * manager_id — кто будет работать вакансию (не обязательно сам заявитель).
 * Менеджеры могут ставить только себя; head/admin — любого активного.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const body: unknown = await request.json();
    const parsed = vacancyRequestCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    const supabase = await createClient();

    // Менеджер не может назначить исполнителя на другого человека.
    if (user.role === 'manager' && input.manager_id && input.manager_id !== user.id) {
      return apiError('FORBIDDEN', 'Менеджер может указывать только себя как исполнителя', 403);
    }

    // Проверяем, что назначенный менеджер активен.
    if (input.manager_id) {
      const { data: mgr } = await supabase
        .from('user_profiles')
        .select('is_active')
        .eq('id', input.manager_id)
        .single();
      if (!mgr) {
        return apiError('NOT_FOUND', 'Менеджер не найден', 404);
      }
      if (!mgr.is_active) {
        return apiError('VALIDATION_ERROR', 'Менеджер неактивен', 400);
      }
    }

    // Привязка к штатке: если задана — title/location берём из строки штатки
    // (авторитетно, целостность привязки). NULL → свободный ввод («нет в штатке»).
    let resolvedTitle = input.title;
    let resolvedLocation = input.location ?? null;
    if (input.staffing_plan_id) {
      const { data: sp } = await supabase
        .from('staffing_plan')
        .select('position_name, city')
        .eq('id', input.staffing_plan_id)
        .maybeSingle();
      if (!sp) {
        return apiError('NOT_FOUND', 'Строка штатки не найдена', 404);
      }
      resolvedTitle = sp.position_name;
      resolvedLocation = sp.city;
    }

    const { data, error } = await supabase
      .from('vacancies')
      .insert({
        title: resolvedTitle,
        department: input.department ?? null,
        subdivision: input.subdivision ?? null,
        location: resolvedLocation,
        customer_name: input.customer_name ?? null,
        priority: input.priority ?? null,
        manager_id: input.manager_id ?? null,
        staffing_plan_id: input.staffing_plan_id ?? null,
        opened_at: input.opened_at,
        status: 'draft',
        confidentiality: input.confidentiality,
        positions_count: input.positions_count,
        request_reason: input.request_reason ?? null,
        request_status: 'pending',
        requested_by: user.id,
      })
      .select('id, status, request_status, confidentiality, title, opened_at, requested_by')
      .single();

    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось создать заявку');
    }

    return apiSuccess({ data }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
