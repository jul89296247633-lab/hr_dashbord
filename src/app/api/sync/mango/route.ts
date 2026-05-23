import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { runMangoSync } from '@/lib/mango';

/**
 * POST /api/sync/mango — ручной on-demand запуск синхронизации Манго ВАТС (head, admin).
 * Тянет звонки за сегодня по менеджерам с mango_extension → daily_activities.
 * Запись — service-role; блокировка параллельного запуска (EC-06).
 */
export async function POST() {
  let user;
  try {
    user = await getAuthUser();
    requireRole(user, ['head', 'admin']);
  } catch (err) {
    return handleApiError(err);
  }

  const db = createAdminClient();

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: running } = await db
    .from('sync_logs')
    .select('id')
    .eq('source', 'mango')
    .eq('status', 'running')
    .gte('started_at', tenMinAgo)
    .limit(1);
  if (running && running.length > 0) {
    return apiError('SYNC_ALREADY_RUNNING', 'Синхронизация Манго уже выполняется. Подождите завершения.', 409);
  }

  const { data: log, error: logError } = await db
    .from('sync_logs')
    .insert({ source: 'mango', status: 'running', triggered_by: user.id })
    .select('id, started_at')
    .single();
  if (logError || !log) {
    return handleApiError(new ApiError(500, 'DB_ERROR', logError?.message ?? 'sync_logs insert failed'));
  }

  try {
    const result = await runMangoSync(db);
    const status = result.errors.length > 0 ? 'partial' : 'ok';
    const finishedAt = new Date().toISOString();

    await db
      .from('sync_logs')
      .update({
        status,
        records_total: result.records_total,
        records_updated: result.records_updated,
        error_message: result.errors.length > 0 ? result.errors.join('; ').slice(0, 1000) : null,
        finished_at: finishedAt,
      })
      .eq('id', log.id);

    return apiSuccess({
      data: {
        sync_log_id: log.id,
        status,
        records_total: result.records_total,
        records_updated: result.records_updated,
        errors: result.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Mango sync error';
    await db
      .from('sync_logs')
      .update({
        status: 'error',
        error_code: 'MANGO_SYNC_ERROR',
        error_message: message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', log.id);
    return handleApiError(err);
  }
}
