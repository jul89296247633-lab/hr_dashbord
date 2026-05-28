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
import { staffingPlanUpsertSchema } from '@/lib/validations';
import type { StaffingPlanRow } from '@/types';

/**
 * GET /api/staffing/plan — штатное расписание с заполненностью на лету.
 * Доступно всем авторизованным (план — мотивационный/прозрачный документ).
 *
 * Источник = RPC compute_staffing_plan (SECURITY DEFINER, FEATURE_SPEC_staffing_plan.md):
 *   • город      = exact equality (vacancies.location = staffing_plan.city)
 *   • должность  = pg_trgm similarity ≥ 0.4 (тот же threshold что у бонусов).
 *
 * Не путать со /api/staffing (% укомплектованности, staffing_records).
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin', 'executive']);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('compute_staffing_plan', {
      p_city: null,
      p_threshold: 0.4,
    });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    type RpcRow = {
      id: string;
      city: string;
      position_name: string;
      planned_units: number;
      comment: string | null;
      created_at: string;
      updated_at: string;
      occupied: number;
      in_progress: number;
      vacant: number;
    };

    const rows = (data as RpcRow[] | null) ?? [];
    const list: StaffingPlanRow[] = rows.map((r) => ({
      id: r.id,
      city: r.city,
      position_name: r.position_name,
      planned: r.planned_units,
      occupied: r.occupied,
      in_progress: r.in_progress,
      vacant: r.vacant,
      comment: r.comment,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return apiSuccess({ data: list });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/staffing/plan — upsert плановой единицы по UNIQUE(city, position_name).
 * Роли: head, admin.
 *
 * Сначала ищем существующую строку — если есть, UPDATE без перезаписи created_by
 * (created_by фиксируется только при INSERT); иначе INSERT с created_by=user.id.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const body: unknown = await request.json();
    const parsed = staffingPlanUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    const supabase = await createClient();
    const selectCols =
      'id, city, position_name, planned_units, comment, created_at, updated_at' as const;

    // Сначала пробуем INSERT. При уникальном конфликте (23505) падаем в UPDATE,
    // не трогая created_by — эмулирует ON CONFLICT DO UPDATE без перезаписи автора.
    const { data: inserted, error: insertError } = await supabase
      .from('staffing_plan')
      .insert({
        city: input.city,
        position_name: input.position_name,
        planned_units: input.planned_units,
        comment: input.comment ?? null,
        created_by: user.id,
      })
      .select(selectCols)
      .single();

    if (!insertError) {
      return apiSuccess(
        {
          data: inserted,
          message: `План добавлен: ${input.city} / ${input.position_name} = ${input.planned_units}`,
        },
        201,
      );
    }

    if (insertError.code !== '23505') {
      throw new ApiError(500, 'DB_ERROR', insertError.message);
    }

    // Уникальный конфликт: обновляем planned_units + comment, created_by не трогаем.
    const { data: updated, error: updateError } = await supabase
      .from('staffing_plan')
      .update({
        planned_units: input.planned_units,
        comment: input.comment ?? null,
      })
      .eq('city', input.city)
      .eq('position_name', input.position_name)
      .select(selectCols)
      .single();
    if (updateError || !updated) {
      throw new ApiError(500, 'DB_ERROR', updateError?.message ?? 'Не удалось обновить план');
    }
    return apiSuccess({
      data: updated,
      message: `План обновлён: ${input.city} / ${input.position_name} = ${input.planned_units}`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
