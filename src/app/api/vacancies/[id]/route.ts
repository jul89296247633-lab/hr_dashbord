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
import { uuidSchema, vacancyUpdateSchema } from '@/lib/validations';
import type { Vacancy, VacancySnapshot, VacancyFunnel } from '@/types';

/**
 * GET /api/vacancies/[id]
 * Вакансия + последний snapshot воронки + число трудоустроенных.
 * manager к чужой вакансии: RLS вернёт пусто → 404 (без раскрытия существования, EC-07).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getAuthUser();
    const { id } = await params;

    // Невалидный UUID трактуем как 404 (не раскрываем формат хранилища).
    if (!uuidSchema.safeParse(id).success) {
      return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);
    }

    const supabase = await createClient();

    // RLS ограничивает видимость: чужая вакансия для manager вернёт null → 404.
    const { data: vacancyRow, error: vacancyError } = await supabase
      .from('vacancies')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (vacancyError) {
      throw new ApiError(500, 'DB_ERROR', vacancyError.message);
    }
    const vacancy = vacancyRow as Vacancy | null;
    if (!vacancy) {
      return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);
    }

    // Последний снимок HH-воронки.
    const { data: snapshotRow, error: snapshotError } = await supabase
      .from('vacancy_snapshots')
      .select('*')
      .eq('vacancy_id', id)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshotError) {
      throw new ApiError(500, 'DB_ERROR', snapshotError.message);
    }
    const snapshot = snapshotRow as VacancySnapshot | null;

    // Число трудоустроенных (employment_type='employee', стажёры не считаются закрытием).
    const { count: hiredCount, error: hiredError } = await supabase
      .from('hired_employees')
      .select('*', { count: 'exact', head: true })
      .eq('vacancy_id', id)
      .eq('employment_type', 'employee');

    if (hiredError) {
      throw new ApiError(500, 'DB_ERROR', hiredError.message);
    }

    const funnel: VacancyFunnel = {
      responses: snapshot?.responses_count ?? 0,
      contacts_opened: snapshot?.contacts_opened ?? 0,
      invitations_from_responses: snapshot?.invitations_from_responses ?? 0,
      views: snapshot?.views_count ?? 0,
      hired: hiredCount ?? 0,
    };

    return apiSuccess({
      data: {
        vacancy,
        funnel,
        last_synced_at: snapshot?.snapshot_at ?? null,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PATCH /api/vacancies/[id] — редактирование вакансии (head, admin).
 * days_to_close пересчитается автоматически (GENERATED) при изменении closed_at.
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
      return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);
    }

    const body: unknown = await request.json();
    const parsed = vacancyUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('vacancies')
      .update(parsed.data)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return apiError('HH_VACANCY_ID_EXISTS', 'Вакансия с таким HH ID уже существует', 409);
      }
      throw new ApiError(500, 'DB_ERROR', error.message);
    }
    if (!data) return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);

    return apiSuccess({ data, message: 'Вакансия сохранена' });
  } catch (err) {
    return handleApiError(err);
  }
}
