/**
 * scripts/refresh-hh-tokens.ts
 *
 * Cron: ежедневно в 07:00 (0 7 * * *)
 * Назначение: превентивное обновление HH OAuth токенов всех менеджеров
 *   ДО запуска sync-hh.ts (08:00). Буфер 48 часов гарантирует,
 *   что к моменту синхронизации все токены действительны.
 *
 * Запуск на Beget VPS:
 *   node /home/user/hr/scripts/dist/scripts/refresh-hh-tokens.js
 *
 * Переменные окружения (.env на VPS):
 *   SUPABASE_URL           — URL проекта Supabase
 *   SUPABASE_SERVICE_ROLE_KEY
 *   HH_CLIENT_ID
 *   HH_CLIENT_SECRET
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_ADMIN_CHAT_ID
 *
 * БЕЗОПАСНОСТЬ: токены (access_token, refresh_token) НИКОГДА не попадают в логи.
 * Логируются только: manager_id, имя менеджера, expires_at, статус операции.
 * В audit_logs токены маскируются на уровне PostgreSQL-триггера (миграция 20260523130000).
 */

import { createClient } from '@supabase/supabase-js';
import { sendAlert, fmt } from './lib/telegram';
import { logError } from './lib/logger';

// ── Загрузка .env ─────────────────────────────────────────────────────────────
// На VPS .env рядом с проектом; в продакшене переменные задаются напрямую.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  // dotenv опционален — env может быть уже загружен systemd/pm2
}

// ── Конфигурация ──────────────────────────────────────────────────────────────
const SUPABASE_URL      = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HH_CLIENT_ID      = process.env.HH_CLIENT_ID?.trim() ?? '';
const HH_CLIENT_SECRET  = process.env.HH_CLIENT_SECRET?.trim() ?? '';

/** Обновлять токены, у которых expires_at < NOW + 48h. */
const REFRESH_BUFFER_MS = 48 * 60 * 60 * 1000;

/** Ретраи при сетевых сбоях HH OAuth. */
const RETRY_DELAYS_MS = [1000, 3000];

// ── Типы ──────────────────────────────────────────────────────────────────────
interface ManagerRow {
  id: string;
  full_name: string | null;
  hh_refresh_token: string | null;
  hh_token_expires_at: string | null;
}

interface HhTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

type RefreshResult =
  | { kind: 'refreshed'; expiresAt: string }
  | { kind: 'revoked' }        // HH вернул 4xx — refresh_token недействителен
  | { kind: 'network_error' }; // сетевой сбой после всех ретраев

// ── Вспомогательные функции ───────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshAndSave(
  db: any,
  managerId: string,
  managerName: string,
  rawRefreshToken: string,
): Promise<RefreshResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: rawRefreshToken,
    client_id: HH_CLIENT_ID,
    client_secret: HH_CLIENT_SECRET,
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch('https://hh.ru/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (res.ok) {
        // Токены получены — немедленно сохраняем в БД, не кешируем в памяти
        const data = (await res.json()) as HhTokenResponse;
        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        const { error } = await db
          .from('user_profiles')
          .update({
            hh_access_token:     data.access_token,
            hh_refresh_token:    data.refresh_token,
            hh_token_expires_at: expiresAt,
          })
          .eq('id', managerId);

        if (error) {
          console.error(`[refresh] DB error for ${managerName} (${managerId}): ${error.message}`);
          return { kind: 'network_error' }; // переиспользуем — нет специального типа для DB error
        }

        // ⚠️ НЕ логируем data.access_token или data.refresh_token
        console.log(`[refresh] OK  ${managerName} (${managerId}) expires=${expiresAt}`);
        return { kind: 'refreshed', expiresAt };
      }

      if (res.status >= 400 && res.status < 500) {
        console.warn(`[refresh] REVOKED  ${managerName} (${managerId}) status=${res.status}`);
        return { kind: 'revoked' };
      }

      console.warn(`[refresh] HH 5xx attempt=${attempt + 1} status=${res.status} manager=${managerId}`);
    } catch (err) {
      console.warn(`[refresh] Network error attempt=${attempt + 1} manager=${managerId}:`, err instanceof Error ? err.message : err);
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  console.warn(`[refresh] NETWORK_ERROR after retries manager=${managerId}`);
  return { kind: 'network_error' };
}

// ── Основная функция ──────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[refresh-hh-tokens] start at ${startedAt}`);

  // ── Валидация конфигурации ─────────────────────────────────────────────────
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[refresh-hh-tokens] FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы');
    process.exit(1);
  }
  if (!HH_CLIENT_ID || !HH_CLIENT_SECRET) {
    console.error('[refresh-hh-tokens] FATAL: HH_CLIENT_ID / HH_CLIENT_SECRET не заданы');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Stale lock recovery ────────────────────────────────────────────────────
  // refresh-hh-tokens обычно занимает < 1 мин. 15 мин = явно мёртвый лок.
  const REFRESH_LOCK_MIN = 15;
  const refreshLockSince = new Date(Date.now() - REFRESH_LOCK_MIN * 60 * 1000).toISOString();

  const { data: staleRuns } = await db
    .from('sync_logs')
    .select('id, started_at')
    .eq('source', 'refresh-hh-tokens')
    .eq('status', 'running')
    .lt('started_at', refreshLockSince);

  if (staleRuns && staleRuns.length > 0) {
    for (const stale of staleRuns) {
      console.warn(`[refresh-hh-tokens] STALE_LOCK_RECOVERED id=${stale.id} started=${stale.started_at}`);
      await db.from('sync_logs').update({
        status:        'error',
        error_code:    'STALE_LOCK_RECOVERED',
        error_message: 'Процесс завершился аварийно (убит или VPS перезагрузка). Lock восстановлен автоматически.',
        finished_at:   new Date().toISOString(),
      }).eq('id', stale.id);
      await logError({
        db,
        source:     'cron_refresh_hh',
        severity:   'warn',
        error_code: 'STALE_LOCK_RECOVERED',
        message:    `sync_log id=${stale.id} (started=${stale.started_at}) — зависший процесс, помечен error.`,
      });
    }
  }

  // ── Создаём запись sync_logs ───────────────────────────────────────────────
  const { data: syncLog, error: syncLogError } = await db
    .from('sync_logs')
    .insert({ source: 'refresh-hh-tokens', status: 'running', triggered_by: null })
    .select('id')
    .single();

  if (syncLogError || !syncLog) {
    console.error('[refresh-hh-tokens] Не удалось создать sync_log:', syncLogError?.message);
    // Продолжаем даже без sync_log — главное обновить токены
  }

  const logId: string | null = syncLog?.id ?? null;

  // ── Загружаем менеджеров с токенами ───────────────────────────────────────
  // Выбираем только менеджеров, у которых уже есть refresh_token
  // ⚠️ НЕ выбираем hh_access_token (он нам не нужен — мы его заменяем)
  const { data: rawManagers, error: fetchError } = await db
    .from('user_profiles')
    .select('id, full_name, hh_refresh_token, hh_token_expires_at')
    .not('hh_refresh_token', 'is', null);
  const managers = (rawManagers ?? []) as ManagerRow[];

  if (fetchError) {
    const msg = `DB error при загрузке менеджеров: ${fetchError.message}`;
    console.error(`[refresh-hh-tokens] ${msg}`);
    await logError({ db, source: 'cron_refresh_hh', severity: 'error', error_code: 'DB_FETCH_ERROR', message: msg });
    if (logId) await db.from('sync_logs').update({ status: 'error', error_code: 'DB_FETCH_ERROR', error_message: msg, finished_at: new Date().toISOString() }).eq('id', logId);
    await sendAlert(fmt('🔴', 'HH Token Refresh — КРИТИЧЕСКАЯ ОШИБКА', msg));
    process.exit(1);
  }

  console.log(`[refresh-hh-tokens] найдено ${managers?.length ?? 0} менеджеров с refresh_token`);

  const thresholdMs = Date.now() + REFRESH_BUFFER_MS;
  const revokedManagers: string[] = [];
  const errorManagers:   string[] = [];
  let   refreshed = 0;
  let   skipped   = 0;

  // ── Обход менеджеров ───────────────────────────────────────────────────────
  for (const mgr of managers ?? []) {
    const name = mgr.full_name ?? 'Неизвестный';

    // Пропускаем, если токен свежий (expires_at > NOW + 48h)
    if (mgr.hh_token_expires_at) {
      const expiresMs = new Date(mgr.hh_token_expires_at).getTime();
      if (expiresMs >= thresholdMs) {
        console.log(`[refresh] SKIP  ${name} (${mgr.id}) expires=${mgr.hh_token_expires_at}`);
        skipped++;
        continue;
      }
    }
    // Если expires_at IS NULL — токен выдан, но дата неизвестна → обновляем

    if (!mgr.hh_refresh_token) {
      // Не должно случиться из-за WHERE NOT NULL, но на случай race condition
      console.warn(`[refresh] NO_REFRESH_TOKEN  ${name} (${mgr.id})`);
      continue;
    }

    const result = await refreshAndSave(db, mgr.id, name, mgr.hh_refresh_token);

    if (result.kind === 'refreshed') {
      refreshed++;

    } else if (result.kind === 'revoked') {
      // Токен отозван: обнуляем access_token, чтобы sync-hh видел HH_TOKEN_MISSING
      await db
        .from('user_profiles')
        .update({ hh_access_token: null })
        .eq('id', mgr.id);

      await logError({
        db,
        source: 'cron_refresh_hh',
        severity: 'warn',
        error_code: 'HH_REFRESH_TOKEN_REVOKED',
        message: `Менеджер ${name} (${mgr.id}): refresh_token недействителен. Требуется повторная авторизация HH.`,
        context: { manager_id: mgr.id }, // ⚠️ НЕ кладём токен в context
      });

      revokedManagers.push(`${name} (${mgr.id})`);

      // Алерт немедленно при каждом отзыве
      await sendAlert(fmt(
        '🔑',
        'HH Token Refresh — требуется авторизация',
        `Менеджер: ${name}\nID: ${mgr.id}\n\nRefresh token недействителен — вероятно, пользователь отозвал доступ или прошло 3 месяца без рефреша.\n\nАдмин: перейдите в /admin/integrations и обновите токен вручную.`,
      ));

    } else {
      // Сетевой сбой после всех ретраев — НЕ обнуляем токен (попробуем завтра)
      await logError({
        db,
        source: 'cron_refresh_hh',
        severity: 'warn',
        error_code: 'HH_NETWORK_ERROR',
        message: `Менеджер ${name} (${mgr.id}): сетевой сбой при обновлении токена. Текущий токен сохранён.`,
        context: { manager_id: mgr.id },
      });
      errorManagers.push(`${name} (${mgr.id})`);
    }
  }

  // ── Финализация sync_logs ─────────────────────────────────────────────────
  const total = (managers?.length ?? 0);
  const failedCount = revokedManagers.length + errorManagers.length;
  const status = failedCount === 0 ? 'ok' : 'partial';

  const errorLines: string[] = [];
  if (revokedManagers.length > 0) errorLines.push(`REVOKED: ${revokedManagers.join(', ')}`);
  if (errorManagers.length > 0)   errorLines.push(`NETWORK_ERROR: ${errorManagers.join(', ')}`);

  const finishedAt = new Date().toISOString();
  if (logId) {
    await db.from('sync_logs').update({
      status,
      records_total:   total,
      records_updated: refreshed,
      error_message: errorLines.length > 0 ? errorLines.join('; ').slice(0, 1000) : null,
      finished_at: finishedAt,
    }).eq('id', logId);
  }

  // ── Итоговый лог ──────────────────────────────────────────────────────────
  console.log(
    `[refresh-hh-tokens] done: total=${total} refreshed=${refreshed} skipped=${skipped} revoked=${revokedManagers.length} network_error=${errorManagers.length} status=${status}`,
  );

  // Суммарный Telegram только если были отозванные (по одному алерту уже отправили выше)
  // Сетевые ошибки — только в error_logs, не тревожим admin'а (попробуем завтра)
  if (revokedManagers.length > 1) {
    await sendAlert(fmt(
      '⚠️',
      `HH Token Refresh — итог (${revokedManagers.length} менеджеров требуют авторизации)`,
      revokedManagers.join('\n'),
    ));
  }

  process.exit(failedCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[refresh-hh-tokens] Uncaught error:', err);
  // Telegram при полном падении скрипта (не при частичном)
  sendAlert(fmt(
    '🔴',
    'HH Token Refresh — НЕОБРАБОТАННАЯ ОШИБКА',
    err instanceof Error ? err.message : String(err),
  )).finally(() => process.exit(1));
});
