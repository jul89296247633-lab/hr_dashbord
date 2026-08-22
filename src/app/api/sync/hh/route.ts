import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runHhSync } from '@/lib/hh-api';

/**
 * GET /api/sync/hh — статус последней HH-синхронизации (head, admin).
 */
export async function GET() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('source', 'hh')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data: data ?? null });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/sync/hh — ручной on-demand запуск HH-синхронизации (head, admin).
 * Тянет counters по активным вакансиям и пишет vacancy_snapshots (см. lib/hh-api).
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
    .eq('source', 'hh')
    .eq('status', 'running')
    .gte('started_at', tenMinAgo)
    .limit(1);
  if (running && running.length > 0) {
    return apiError('SYNC_ALREADY_RUNNING', 'Синхронизация HH уже выполняется. Подождите завершения.', 409);
  }

  const { data: log, error: logError } = await db
    .from('sync_logs')
    .insert({ source: 'hh', status: 'running', triggered_by: user.id })
    .select('id, started_at')
    .single();
  if (logError || !log) {
    return handleApiError(new ApiError(500, 'DB_ERROR', logError?.message ?? 'sync_logs insert failed'));
  }

  try {
    const result = await runHhSync(db);
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
        phone_calls_updated: result.phone_calls_updated,
        errors: result.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown HH sync error';
    await db
      .from('sync_logs')
      .update({
        status: 'error',
        error_code: 'HH_SYNC_ERROR',
        error_message: message.slice(0, 1000),
        finished_at: new Date().toISOString(),
      })
      .eq('id', log.id);
    return handleApiError(err);
  }
}
