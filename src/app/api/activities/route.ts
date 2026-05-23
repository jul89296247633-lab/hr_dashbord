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
import { activityUpsertSchema } from '@/lib/validations';
import type { DailyActivity, DailyActivityWithTotal } from '@/types';

/** Поля upsert в daily_activities. */
interface ActivityUpsertRow {
  manager_id: string;
  activity_date: string;
  interviews_count: number;
  offers_count: number;
  notes: string | null;
  hh_calls_count?: number;
  hh_calls_source?: 'manual';
}

/**
 * POST /api/activities
 * Создаёт/обновляет активности за день (upsert по manager_id + activity_date).
 * - manager — только свои; head/admin — чужие через body.manager_id.
 * - Дата не из будущего → 422 FUTURE_DATE_NOT_ALLOWED.
 * - Для manager дата не старше 30 дней → 422 DATE_TOO_OLD (head/admin без ограничения).
 * - hh_calls_count, переданный вручную → hh_calls_source = 'manual'.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const body: unknown = await request.json();
    const parsed = activityUpsertSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const input = parsed.data;

    // Дата не из будущего.
    if (isFutureDate(input.activity_date)) {
      return apiError(
        'FUTURE_DATE_NOT_ALLOWED',
        'Нельзя вводить активности за будущую дату',
        422,
      );
    }

    // Чей день записываем.
    let targetManagerId = user.id;
    if (input.manager_id && input.manager_id !== user.id) {
      requireRole(user, ['head', 'admin']);
      targetManagerId = input.manager_id;
    }

    // Правило «не старше 30 дней» — только для самого менеджера (override SPEC §5.2: было 7).
    if (user.role === 'manager' && isOlderThanDays(input.activity_date, 30)) {
      return apiError(
        'DATE_TOO_OLD',
        'Можно вводить данные только за последние 30 дней',
        422,
      );
    }

    const row: ActivityUpsertRow = {
      manager_id: targetManagerId,
      activity_date: input.activity_date,
      interviews_count: input.interviews_count,
      offers_count: input.offers_count,
      notes: input.notes ?? null,
    };
    // HH-звонки заполняются вручную только если значение явно передано.
    if (input.hh_calls_count !== undefined && input.hh_calls_count !== null) {
      row.hh_calls_count = input.hh_calls_count;
      row.hh_calls_source = 'manual';
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('daily_activities')
      .upsert(row, { onConflict: 'manager_id,activity_date' })
      .select('*')
      .single();

    if (error || !data) {
      throw new ApiError(500, 'DB_ERROR', error?.message ?? 'Не удалось сохранить активности');
    }

    const saved = data as DailyActivity;
    const activity: DailyActivityWithTotal = {
      ...saved,
      total_calls: (saved.mango_calls_count ?? 0) + (saved.hh_calls_count ?? 0),
    };

    return apiSuccess({
      data: activity,
      message: `Данные за ${input.activity_date} сохранены`,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** true, если дата (YYYY-MM-DD) позже сегодняшнего дня. */
function isFutureDate(date: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${date}T00:00:00`).getTime() > today.getTime();
}

/** true, если дата старше, чем N дней назад от сегодня. */
function isOlderThanDays(date: string, days: number): boolean {
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - days);
  return new Date(`${date}T00:00:00`).getTime() < threshold.getTime();
}
