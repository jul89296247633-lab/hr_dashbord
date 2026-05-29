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

    const { data, error } = await supabase
      .from('vacancies')
      .insert({
        title: input.title,
        department: input.department ?? null,
        subdivision: input.subdivision ?? null,
        location: input.location ?? null,
        manager_id: input.manager_id ?? null,
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
