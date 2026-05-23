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
import { bonusMatchSchema, uuidSchema } from '@/lib/validations';

/**
 * PATCH /api/bonuses/[id]/match — ручная привязка бонуса к вакансии (head, admin),
 * когда fuzzy-match не сработал. Body: { vacancy_id }.
 *
 * hr_bonuses — таблица, наполняемая синхронизацией (политики *_service_write),
 * поэтому правка идёт service-role клиентом после проверки роли.
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
      return apiError('BONUS_NOT_FOUND', 'Бонус не найден', 404);
    }

    const body: unknown = await request.json();
    const parsed = bonusMatchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { vacancy_id } = parsed.data;

    const db = createAdminClient();

    // Вакансия должна существовать.
    const { data: vacancy, error: vacancyError } = await db
      .from('vacancies')
      .select('id')
      .eq('id', vacancy_id)
      .maybeSingle();
    if (vacancyError) throw new ApiError(500, 'DB_ERROR', vacancyError.message);
    if (!vacancy) return apiError('VACANCY_NOT_FOUND', 'Вакансия не найдена', 404);

    const { data, error } = await db
      .from('hr_bonuses')
      .update({ vacancy_id })
      .eq('id', id)
      .select('id, vacancy_id')
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('BONUS_NOT_FOUND', 'Бонус не найден', 404);

    return apiSuccess({ data: { ...data, matched_manually: true } });
  } catch (err) {
    return handleApiError(err);
  }
}
