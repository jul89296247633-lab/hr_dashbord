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
import { dateStringSchema } from '@/lib/validations';
import type { DailyActivity, DailyActivityWithTotal } from '@/types';

/**
 * GET /api/activities/[date]
 * Активности менеджера за дату (YYYY-MM-DD).
 * - manager — только свои; head/admin — чужие через ?manager_id=uuid.
 * - Записи нет → возвращаем { data: null } (не 404: форма должна знать, что пусто).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  try {
    const user = await getAuthUser();
    const { date } = await params;

    // Формат даты.
    const parsedDate = dateStringSchema.safeParse(date);
    if (!parsedDate.success) {
      return apiError('INVALID_DATE_FORMAT', 'Дата должна быть в формате YYYY-MM-DD', 400);
    }

    // Дата не из будущего.
    if (isFutureDate(date)) {
      return apiError(
        'FUTURE_DATE_NOT_ALLOWED',
        'Нельзя запрашивать активности за будущую дату',
        422,
      );
    }

    // Чей день запрашиваем.
    const queryManagerId = request.nextUrl.searchParams.get('manager_id');
    let targetManagerId = user.id;
    if (queryManagerId && queryManagerId !== user.id) {
      requireRole(user, ['head', 'admin']);
      targetManagerId = queryManagerId;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('daily_activities')
      .select('*')
      .eq('manager_id', targetManagerId)
      .eq('activity_date', date)
      .maybeSingle();

    if (error) {
      throw new ApiError(500, 'DB_ERROR', error.message);
    }

    const activity = data as DailyActivity | null;
    const result: DailyActivityWithTotal | null = activity
      ? { ...activity, total_calls: totalCalls(activity) }
      : null;

    return apiSuccess({ data: result });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Итого звонков = Манго + HH (CLAUDE.md правило №7). */
function totalCalls(a: DailyActivity): number {
  return (a.mango_calls_count ?? 0) + (a.hh_calls_count ?? 0);
}

/** true, если дата (YYYY-MM-DD) позже сегодняшнего дня. */
function isFutureDate(date: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requested = new Date(`${date}T00:00:00`);
  return requested.getTime() > today.getTime();
}
