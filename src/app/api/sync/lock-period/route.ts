import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
  monthRangeFromYM,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { monthYmSchema } from '@/lib/validations';

/**
 * POST /api/sync/lock-period?month=YYYY-MM — фиксирует исторические данные.
 *
 * Выставляет `vacancy_snapshots.is_locked = TRUE` для всех snapshot'ов
 * в указанном месяце. После lock'а hh-csv sync с `stat_date` из этого
 * месяца игнорирует перезапись и инкрементирует `rows_skipped_locked`.
 *
 * Только head/admin (см. CLAUDE.md §1: schema-write — service-role).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const month = request.nextUrl.searchParams.get('month');
    const parsed = monthYmSchema.safeParse(month);
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const range = monthRangeFromYM(parsed.data);

    const db = createAdminClient();
    const dayAfter = `${range.to}T23:59:59Z`;
    const dayFrom = `${range.from}T00:00:00Z`;

    const { count, error } = await db
      .from('vacancy_snapshots')
      .update({ is_locked: true }, { count: 'exact' })
      .gte('snapshot_at', dayFrom)
      .lte('snapshot_at', dayAfter)
      .eq('is_locked', false);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Фиксацию запишем в sync_logs — отдельный source 'lock-period' с иконкой
    // 🔒 в UI журнала (SyncLogsClient).
    await db.from('sync_logs').insert({
      source: 'lock-period',
      status: 'ok',
      records_total: count ?? 0,
      records_updated: count ?? 0,
      error_message: `Зафиксирован период ${parsed.data}`,
      triggered_by: user.id,
      finished_at: new Date().toISOString(),
    });

    return apiSuccess({
      data: {
        month: parsed.data,
        from: range.from,
        to: range.to,
        locked_count: count ?? 0,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
