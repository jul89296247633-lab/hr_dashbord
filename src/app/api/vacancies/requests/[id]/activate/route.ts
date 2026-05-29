import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { uuidSchema, vacancyActivateSchema } from '@/lib/validations';
import { generateInternalRef } from '@/lib/templates/internal-ref';

/**
 * PATCH /api/vacancies/requests/[id]/activate
 * Активировать согласованную заявку. Доступно автору заявки или head/admin.
 *
 * Две ветки (по confidentiality):
 *   open          → требует hh_vacancy_id в теле; устанавливает status='active'.
 *   confidential  → hh_vacancy_id не нужен; gen_internal_ref() через RPC,
 *                   затем status='active'. Триггер enforce_request_approval
 *                   подхватит internal_ref или сгенерирует сам (страховка).
 *
 * Триггер enforce_request_approval на уровне БД дополнительно гарантирует:
 *   • request_status = 'approved' (иначе EXCEPTION)
 *   • открытая без hh_vacancy_id → EXCEPTION
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('NOT_FOUND', 'Заявка не найдена', 404);
    }

    const body: unknown = await request.json().catch(() => ({}));
    const parsed = vacancyActivateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { hh_vacancy_id } = parsed.data;

    const supabase = await createClient();

    const { data: vacancy, error: fetchError } = await supabase
      .from('vacancies')
      .select('id, status, request_status, confidentiality, requested_by, internal_ref')
      .eq('id', id)
      .single();

    if (fetchError || !vacancy) {
      return apiError('NOT_FOUND', 'Заявка не найдена', 404);
    }

    // Только автор заявки или head/admin могут активировать.
    const canActivate =
      vacancy.requested_by === user.id ||
      user.role === 'head' ||
      user.role === 'admin';
    if (!canActivate) {
      return apiError('FORBIDDEN', 'Недостаточно прав для активации заявки', 403);
    }

    if (vacancy.status !== 'draft') {
      return apiError('INVALID_STATE', 'Активировать можно только черновик', 409);
    }
    if (vacancy.request_status !== 'approved') {
      return apiError('NOT_APPROVED', 'Заявка ещё не согласована', 409);
    }

    // Бизнес-правила по конфиденциальности.
    if (vacancy.confidentiality === 'open') {
      if (!hh_vacancy_id) {
        return apiError('HH_ID_REQUIRED', 'Открытая вакансия требует hh_vacancy_id', 400);
      }
      // Проверяем уникальность HH ID.
      const { data: dup } = await supabase
        .from('vacancies')
        .select('id')
        .eq('hh_vacancy_id', hh_vacancy_id)
        .maybeSingle();
      if (dup) {
        return apiError('DUPLICATE_HH_ID', 'Вакансия с этим HH ID уже существует', 409);
      }
    }

    // Для конфиденциальной: генерируем internal_ref через sequence (единственный источник).
    // Задаём заранее, чтобы триггер не генерировал повторно.
    let internalRef = vacancy.internal_ref ?? null;
    if (vacancy.confidentiality === 'confidential' && !internalRef) {
      internalRef = await generateInternalRef(supabase);
    }

    const { data, error } = await supabase
      .from('vacancies')
      .update({
        status: 'active',
        hh_vacancy_id: hh_vacancy_id ?? undefined,
        internal_ref: internalRef ?? undefined,
      })
      .eq('id', id)
      .select('id, status, hh_vacancy_id, internal_ref, confidentiality')
      .single();

    if (error || !data) {
      // Триггер enforce_request_approval → EXCEPTION → P0001
      if (error?.code === 'P0001') {
        return apiError('ACTIVATION_BLOCKED', error.message, 409);
      }
      // 23505 — дубль hh_vacancy_id (race condition между проверкой и insert).
      if (error?.code === '23505') {
        return apiError('DUPLICATE_HH_ID', 'Вакансия с этим HH ID уже существует', 409);
      }
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось активировать вакансию');
    }

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
