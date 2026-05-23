import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { bonusesSummaryPeriodSchema } from '@/lib/validations';

/**
 * GET /api/bonuses/summary — сводка бонусов по менеджерам за период (week|month|quarter|year).
 * manager — только свой ряд (RLS); head/admin — все.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const periodParsed = bonusesSummaryPeriodSchema.safeParse(
      request.nextUrl.searchParams.get('period') ?? undefined,
    );
    if (!periodParsed.success) {
      return apiError('VALIDATION_ERROR', periodParsed.error.issues[0].message, 422);
    }
    const { from, to } = periodRange(periodParsed.data);

    const supabase = await createClient();
    let query = supabase
      .from('hr_bonuses')
      .select(
        'manager_id, bonus_amount_kopecks, bonus_date, status, manager:user_profiles!hr_bonuses_manager_id_fkey(id, full_name)',
      )
      .not('manager_id', 'is', null)
      .gte('bonus_date', from)
      .lte('bonus_date', to);
    if (user.role === 'manager') query = query.eq('manager_id', user.id);

    const { data, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Группировка по менеджеру.
    const byManager = new Map<
      string,
      {
        full_name: string;
        count: number;
        pending: number;
        paid: number;
        lastDate: string | null;
      }
    >();

    for (const b of data ?? []) {
      if (!b.manager_id) continue;
      const entry =
        byManager.get(b.manager_id) ??
        { full_name: b.manager?.full_name ?? '—', count: 0, pending: 0, paid: 0, lastDate: null };
      entry.count += 1;
      if (b.status === 'paid') entry.paid += b.bonus_amount_kopecks ?? 0;
      else entry.pending += b.bonus_amount_kopecks ?? 0;
      if (!entry.lastDate || b.bonus_date > entry.lastDate) entry.lastDate = b.bonus_date;
      byManager.set(b.manager_id, entry);
    }

    const summary = Array.from(byManager.entries()).map(([managerId, e]) => ({
      manager_id: managerId,
      full_name: e.full_name,
      bonuses_count: e.count,
      total_pending_kopecks: e.pending,
      total_paid_kopecks: e.paid,
      total_display: formatKopecks(e.pending + e.paid),
      last_bonus_date: e.lastDate,
    }));

    return apiSuccess({ data: summary });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Копейки → «250 000 ₽». */
function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')} ₽`;
}

/** Диапазон периода [from, to=сегодня]. */
function periodRange(period: 'week' | 'month' | 'quarter' | 'year'): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (period === 'week') {
    const offset = (today.getDay() + 6) % 7;
    start.setDate(today.getDate() - offset);
  } else if (period === 'month') {
    start.setMonth(today.getMonth(), 1);
  } else if (period === 'quarter') {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
    start.setMonth(qStartMonth, 1);
  } else {
    start.setMonth(0, 1);
  }
  return { from: start.toISOString().slice(0, 10), to };
}
