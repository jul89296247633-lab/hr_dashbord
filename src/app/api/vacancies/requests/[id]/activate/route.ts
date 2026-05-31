import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema, vacancyActivateSchema } from '@/lib/validations';
import { generateInternalRef } from '@/lib/templates/internal-ref';
import type { Database } from '@/types';

type VacancyInsert = Database['public']['Tables']['vacancies']['Insert'];

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
      .select(
        'id, status, request_status, confidentiality, requested_by, internal_ref, positions_count, opened_at, title, department, subdivision, location, customer_name, priority, manager_id, staffing_plan_id',
      )
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

    const today = new Date().toISOString().slice(0, 10);
    const positions = vacancy.positions_count ?? 1;

    // Для конфиденциальной: internal_ref первой строки (sequence — единственный источник).
    let internalRef = vacancy.internal_ref ?? null;
    if (vacancy.confidentiality === 'confidential' && !internalRef) {
      internalRef = await generateInternalRef(supabase);
    }

    // ── Одиночная позиция: UPDATE draft → active (как раньше) ───────────────────
    if (positions <= 1) {
      const { data, error } = await supabase
        .from('vacancies')
        .update({
          status: 'active',
          opened_at: vacancy.opened_at ?? today,
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
        // 23505 — дубль hh_vacancy_id (race condition).
        if (error?.code === '23505') {
          return apiError('DUPLICATE_HH_ID', 'Вакансия с этим HH ID уже существует', 409);
        }
        throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось активировать вакансию');
      }
      return apiSuccess({ data });
    }

    // ── Мульти-позиция: N строк-вакансий в группе (для эстафеты дат) ────────────
    // Авторизация уже пройдена (canActivate). Запись через service-role: RLS на
    // запись active-строк — только head/admin; автор-executive иначе не прошёл бы.
    const db = createAdminClient();
    const groupId = crypto.randomUUID();

    // 1) Исходная строка → active, queue_index=1, группа, opened_at=today.
    const { error: firstErr } = await db
      .from('vacancies')
      .update({
        status: 'active',
        opened_at: today,
        position_group_id: groupId,
        queue_index: 1,
        hh_vacancy_id: vacancy.confidentiality === 'open' ? (hh_vacancy_id ?? undefined) : undefined,
        internal_ref: internalRef ?? undefined,
      })
      .eq('id', id);
    if (firstErr) {
      if (firstErr.code === 'P0001') return apiError('ACTIVATION_BLOCKED', firstErr.message, 409);
      if (firstErr.code === '23505') return apiError('DUPLICATE_HH_ID', 'Вакансия с этим HH ID уже существует', 409);
      throw new ApiError(500, 'DB_ERROR', firstErr.message);
    }

    // 2) Сиблинги queue_index 2..N. EC-13: hh_id только у первой → у сиблингов null.
    //    Confidential — свой internal_ref на каждую (sequence).
    const siblings: VacancyInsert[] = [];
    for (let q = 2; q <= positions; q++) {
      let sibRef: string | null = null;
      if (vacancy.confidentiality === 'confidential') {
        sibRef = await generateInternalRef(db);
      }
      siblings.push({
        title: vacancy.title,
        department: vacancy.department ?? null,
        subdivision: vacancy.subdivision ?? null,
        location: vacancy.location ?? null,
        customer_name: vacancy.customer_name ?? null,
        priority: vacancy.priority ?? null,
        manager_id: vacancy.manager_id ?? null,
        staffing_plan_id: vacancy.staffing_plan_id ?? null,  // сиблинги той же позиции штатки
        confidentiality: vacancy.confidentiality as 'open' | 'confidential',
        status: 'active',
        opened_at: today,
        position_group_id: groupId,
        queue_index: q,
        positions_count: 1,
        hh_vacancy_id: null,
        internal_ref: sibRef,
      });
    }
    const { error: sibErr } = await db.from('vacancies').insert(siblings);
    if (sibErr) {
      throw new ApiError(500, 'DB_ERROR', `Не удалось создать позиции группы: ${sibErr.message}`);
    }

    return apiSuccess({ data: { group_id: groupId, created: positions, status: 'active' } });
  } catch (err) {
    return handleApiError(err);
  }
}
