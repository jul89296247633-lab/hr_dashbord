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
import { isoWeekSchema } from '@/lib/validations';

/**
 * GET /api/ai/report/[week] — еженедельный AI-отчёт по ISO-неделе (например 2026-W21).
 * Авторизация: head, admin. Ищет ai_insights(weekly_report) по понедельнику недели.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ week: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const { week } = await params;
    if (!isoWeekSchema.safeParse(week).success) {
      return apiError('VALIDATION_ERROR', 'Формат недели: YYYY-Www (например 2026-W21)', 422);
    }

    const { monday, sunday } = isoWeekRange(week);

    const supabase = await createClient();
    // weekly_report за неделю: период отчёта пересекается с [monday, sunday].
    const { data, error } = await supabase
      .from('ai_insights')
      .select('id, period_start, period_end, title, body_md, meta_json, tokens_used, created_at')
      .eq('insight_type', 'weekly_report')
      .lte('period_start', sunday)
      .gte('period_end', monday)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) {
      return apiError('REPORT_NOT_FOUND', `Отчёт за неделю ${week} ещё не сгенерирован`, 404);
    }

    return apiSuccess({
      data: {
        ...data,
        week,
        period: `${formatRu(monday)} — ${formatRu(sunday)}`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** ISO-неделя YYYY-Www → понедельник и воскресенье (YYYY-MM-DD, UTC). */
function isoWeekRange(week: string): { monday: string; sunday: string } {
  const [yearStr, weekStr] = week.split('-W');
  const year = Number(yearStr);
  const weekNum = Number(weekStr);

  // 4 января всегда в 1-й ISO-неделе.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7; // 1..7 (Пн..Вс)
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1) + (weekNum - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { monday: monday.toISOString().slice(0, 10), sunday: sunday.toISOString().slice(0, 10) };
}

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function formatRu(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${Number(d)} ${RU_MONTHS[Number(m) - 1]}`;
}
