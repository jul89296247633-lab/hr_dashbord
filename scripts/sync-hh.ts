/**
 * scripts/sync-hh.ts
 *
 * Cron: рабочие дни каждые 2 часа с 08:00 до 22:00
 *   0 8,10,12,14,16,18,20,22 * * 1-5
 *
 * Назначение: синхронизация воронки HH API (responses/views/invitations)
 * по всем активным вакансиям с hh_vacancy_id. Пишет vacancy_snapshots.
 *
 * Запуск на Beget VPS:
 *   node /home/user/hr/scripts/dist/scripts/sync-hh.js
 *
 * Переменные окружения (.env на VPS):
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   HH_CLIENT_ID, HH_CLIENT_SECRET
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID
 *
 * Идемпотентность:
 *   vacancies  — только UPDATE (status/closed_at), без INSERT → идемпотентно
 *   snapshots  — INSERT per run (один снимок за прогон) — это дизайн (тренды).
 *                Параллельные запуски заблокированы lock'ом через sync_logs.
 *
 * Не-HR менеджеры:
 *   Если manager_id вакансии не в hr_manager_syncs → SKIPPED_NON_HR_MANAGER.
 *   Повторный прогон — тот же skip. Cron не воскрешает деактивированных.
 */

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  // env может быть уже загружен systemd/pm2
}

import { createClient } from '@supabase/supabase-js';
import { sendAlert, fmt }  from './lib/telegram';
import { logError }        from './lib/logger';

// ── Конфигурация ──────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HH_CLIENT_ID     = process.env.HH_CLIENT_ID?.trim() ?? '';
const HH_CLIENT_SECRET = process.env.HH_CLIENT_SECRET?.trim() ?? '';

/** Задержка между вызовами HH API (≈3 req/s — ниже лимита HH). */
const CALL_DELAY_MS = 300;

/** Lock: если sync уже запущен в последние N минут — пропускаем прогон. */
const LOCK_WINDOW_MIN = 10;

/** Порог: отправляем Telegram только если ошибок больше этого числа. */
const ALERT_THRESHOLD = 3;

// ── Типы ──────────────────────────────────────────────────────────────────────
interface VacancyRow {
  id: string;
  hh_vacancy_id: string;
  manager_id: string | null;
  manager: {
    is_active: boolean;
    hh_access_token: string | null;
    hh_refresh_token: string | null;
    hh_token_expires_at: string | null;
  } | null;
}

interface HhVacancyResponse {
  status?: { id?: string };
  counters?: {
    responses?: number;
    views?: number;
    invitations?: number;
  };
}

type FetchResult =
  | { kind: 'ok'; data: HhVacancyResponse }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

interface RunResult {
  total: number;
  updated: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

// ── Утилиты ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── HH API ────────────────────────────────────────────────────────────────────

/** Запрос статистики вакансии с ретраями и обработкой rate limit. */
async function fetchVacancyStats(token: string, hhId: string): Promise<FetchResult> {
  const url = `https://api.hh.ru/vacancies/${hhId}`;
  const delays = [1000, 3000];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (res.ok) {
        return { kind: 'ok', data: (await res.json()) as HhVacancyResponse };
      }
      if (res.status === 404) return { kind: 'not_found' };
      if (res.status === 429) {
        // Ждём 10s и пробуем ещё раз
        if (attempt < delays.length) {
          console.warn(`[sync-hh] HH rate limit (429), hh_vacancy_id=${hhId}, retry after 10s`);
          await sleep(10_000);
          continue;
        }
        return { kind: 'rate_limited' };
      }
      // 5xx — стандартный retry
    } catch {
      // сетевой сбой
    }

    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  return { kind: 'failed' };
}

/**
 * Обновляет OAuth-токен через refresh_token. Сохраняет новые токены в БД.
 * НЕ логирует значения токенов.
 */
async function tryRefreshToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  managerId: string,
  refreshToken: string,
): Promise<string | null> {
  try {
    const res = await fetch('https://hh.ru/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: HH_CLIENT_ID,
        client_secret: HH_CLIENT_SECRET,
      }),
    });

    if (!res.ok) return null; // refresh_token протух или отозван

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    await db.from('user_profiles').update({
      hh_access_token:     data.access_token,
      hh_refresh_token:    data.refresh_token,
      hh_token_expires_at: expiresAt,
    }).eq('id', managerId);

    // ⚠️ НЕ логируем data.access_token / data.refresh_token
    console.log(`[sync-hh] token refreshed for manager=${managerId} expires=${expiresAt}`);
    return data.access_token;
  } catch {
    return null;
  }
}

// ── Основная функция синхронизации ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runSync(db: any): Promise<RunResult> {
  const todayStr = today();

  // ── Загружаем активные вакансии с hh_vacancy_id ──────────────────────────
  const { data: rawVacancies, error: fetchErr } = await db
    .from('vacancies')
    .select([
      'id',
      'hh_vacancy_id',
      'manager_id',
      'manager:user_profiles!vacancies_manager_id_fkey(is_active, hh_access_token, hh_refresh_token, hh_token_expires_at)',
    ].join(', '))
    .eq('status', 'active')
    .not('hh_vacancy_id', 'is', null);

  if (fetchErr) throw new Error(`DB fetch vacancies: ${fetchErr.message}`);
  const vacancies = (rawVacancies ?? []) as VacancyRow[];

  // ── Загружаем множество hr_manager_syncs.user_id (для проверки не-HR) ────
  const { data: hrSyncs } = await db
    .from('hr_manager_syncs')
    .select('user_id')
    .not('user_id', 'is', null);
  const hrUserIds = new Set<string>(
    (hrSyncs ?? []).map((r: { user_id: string }) => r.user_id),
  );

  console.log(`[sync-hh] found ${vacancies.length} vacancies to process`);

  const result: RunResult = { total: vacancies.length, updated: 0, skipped: 0, errors: 0, errorMessages: [] };

  for (let i = 0; i < vacancies.length; i++) {
    const v = vacancies[i];

    // ── Задержка между HH API вызовами ────────────────────────────────────
    if (i > 0) await sleep(CALL_DELAY_MS);

    const mgr = v.manager;

    // ── Пропуск: менеджер уволен (is_active=false) ────────────────────────
    if (!mgr || !mgr.is_active) {
      console.log(`[sync-hh] SKIP INACTIVE_MANAGER vacancy=${v.id}`);
      result.skipped++;
      result.errorMessages.push(`SKIPPED_INACTIVE_MANAGER vacancy_id=${v.id}`);
      continue;
    }

    // ── Пропуск: менеджер не в hr_manager_syncs (не наш HR) ──────────────
    // Запись в БД не трогаем — чистку делает admin через UI, не cron.
    if (v.manager_id && !hrUserIds.has(v.manager_id)) {
      console.warn(`[sync-hh] SKIP NON_HR_MANAGER vacancy=${v.id} manager=${v.manager_id}`);
      await logError({
        db,
        source: 'cron_sync_hh',
        severity: 'warn',
        error_code: 'SKIPPED_NON_HR_MANAGER',
        message: `Вакансия ${v.id}: менеджер ${v.manager_id} не в hr_manager_syncs. Вакансия пропущена.`,
        context: { vacancy_id: v.id, manager_id: v.manager_id },
      });
      result.skipped++;
      result.errorMessages.push(`SKIPPED_NON_HR_MANAGER vacancy_id=${v.id} manager_id=${v.manager_id}`);
      continue;
    }

    // ── Пропуск: нет токена (refresh_token протух, cron refresh его обнулил) ─
    if (!mgr.hh_access_token) {
      console.warn(`[sync-hh] SKIP TOKEN_MISSING vacancy=${v.id} manager=${v.manager_id}`);
      await logError({
        db,
        source: 'cron_sync_hh',
        severity: 'warn',
        error_code: 'HH_TOKEN_MISSING',
        message: `Вакансия ${v.id}: менеджер ${v.manager_id} без hh_access_token. Требуется переавторизация.`,
        context: { vacancy_id: v.id, manager_id: v.manager_id },
      });
      result.skipped++;
      result.errorMessages.push(`HH_TOKEN_MISSING vacancy_id=${v.id} manager_id=${v.manager_id}`);
      continue;
    }

    // ── Превентивный рефреш токена (expires_at < NOW + 24h) ──────────────
    let token = mgr.hh_access_token;
    const expiresAt = mgr.hh_token_expires_at ? new Date(mgr.hh_token_expires_at) : null;
    const refreshThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (expiresAt && expiresAt < refreshThreshold && mgr.hh_refresh_token && v.manager_id) {
      const newToken = await tryRefreshToken(db, v.manager_id, mgr.hh_refresh_token);
      if (newToken) {
        token = newToken;
      } else {
        // Рефреш не удался — обнуляем access_token, пропускаем вакансию
        await db.from('user_profiles').update({ hh_access_token: null }).eq('id', v.manager_id);
        await logError({
          db,
          source: 'cron_sync_hh',
          severity: 'warn',
          error_code: 'HH_TOKEN_REFRESH_FAILED',
          message: `Менеджер ${v.manager_id}: рефреш токена не удался во время sync. access_token обнулён.`,
          context: { manager_id: v.manager_id, vacancy_id: v.id },
        });
        await sendAlert(fmt(
          '🔑',
          'HH Sync — рефреш токена не удался',
          `Менеджер ID: ${v.manager_id}\nВакансия: ${v.id}\n\nPerейдите в /admin/integrations и обновите токен вручную.`,
        ));
        result.skipped++;
        result.errorMessages.push(`HH_TOKEN_REFRESH_FAILED manager_id=${v.manager_id}`);
        continue;
      }
    }

    // ── Запрос к HH API ───────────────────────────────────────────────────
    const fetchResult = await fetchVacancyStats(token, v.hh_vacancy_id);

    if (fetchResult.kind === 'not_found') {
      // Вакансия удалена/архивирована на HH → авто-закрытие (EC-03)
      await db.from('vacancies').update({ status: 'closed', closed_at: todayStr }).eq('id', v.id);
      console.log(`[sync-hh] AUTO_CLOSED hh_vacancy_id=${v.hh_vacancy_id} vacancy=${v.id}`);
      result.errorMessages.push(`AUTO_CLOSED hh_vacancy_id=${v.hh_vacancy_id}`);
      // Не увеличиваем errors — это штатная ситуация (EC-03)
      continue;
    }

    if (fetchResult.kind === 'rate_limited') {
      await logError({
        db,
        source: 'cron_sync_hh',
        severity: 'warn',
        error_code: 'HH_RATE_LIMITED',
        message: `HH 429 после ретрая для hh_vacancy_id=${v.hh_vacancy_id}. Вакансия пропущена.`,
        context: { vacancy_id: v.id, hh_vacancy_id: v.hh_vacancy_id },
      });
      console.warn(`[sync-hh] RATE_LIMITED hh_vacancy_id=${v.hh_vacancy_id}`);
      result.errors++;
      result.skipped++;
      result.errorMessages.push(`HH_RATE_LIMITED hh_vacancy_id=${v.hh_vacancy_id}`);
      continue;
    }

    if (fetchResult.kind === 'failed') {
      await logError({
        db,
        source: 'cron_sync_hh',
        severity: 'warn',
        error_code: 'HH_FETCH_FAILED',
        message: `Сетевой сбой при запросе hh_vacancy_id=${v.hh_vacancy_id}. Пропущено.`,
        context: { vacancy_id: v.id, hh_vacancy_id: v.hh_vacancy_id },
      });
      console.warn(`[sync-hh] FETCH_FAILED hh_vacancy_id=${v.hh_vacancy_id}`);
      result.errors++;
      result.skipped++;
      result.errorMessages.push(`HH_FETCH_FAILED hh_vacancy_id=${v.hh_vacancy_id}`);
      continue;
    }

    // ── Успех: сохраняем снимок воронки ──────────────────────────────────
    const stats = fetchResult.data;

    // Авто-закрытие архивированных
    if (stats.status?.id === 'archived') {
      await db.from('vacancies').update({ status: 'closed', closed_at: todayStr }).eq('id', v.id);
      result.errorMessages.push(`AUTO_CLOSED_ARCHIVED hh_vacancy_id=${v.hh_vacancy_id}`);
    }

    const { error: snapErr } = await db.from('vacancy_snapshots').insert({
      vacancy_id:                v.id,
      responses_count:           stats.counters?.responses ?? 0,
      views_count:               stats.counters?.views ?? 0,
      invitations_from_responses: stats.counters?.invitations ?? 0,
      source:                    'hh_api',
    });

    if (snapErr) {
      await logError({
        db,
        source: 'cron_sync_hh',
        severity: 'error',
        error_code: 'SNAPSHOT_INSERT_FAILED',
        message: `Ошибка вставки snapshot для vacancy=${v.id}: ${snapErr.message}`,
        context: { vacancy_id: v.id, db_error: snapErr.message },
      });
      console.error(`[sync-hh] SNAPSHOT_INSERT_FAILED vacancy=${v.id}: ${snapErr.message}`);
      result.errors++;
      result.errorMessages.push(`SNAPSHOT_INSERT_FAILED vacancy_id=${v.id}`);
    } else {
      result.updated++;
      console.log(`[sync-hh] OK vacancy=${v.id} hh=${v.hh_vacancy_id} r=${stats.counters?.responses ?? 0}`);
    }
  }

  return result;
}

// ── Entrypoint ────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[sync-hh] start at ${startedAt}`);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[sync-hh] FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы');
    process.exit(1);
  }
  if (!HH_CLIENT_ID || !HH_CLIENT_SECRET) {
    console.error('[sync-hh] FATAL: HH_CLIENT_ID / HH_CLIENT_SECRET не заданы');
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Lock: предотвращаем параллельный запуск ───────────────────────────────
  const lockSince = new Date(Date.now() - LOCK_WINDOW_MIN * 60 * 1000).toISOString();
  const { data: running } = await db
    .from('sync_logs')
    .select('id, started_at')
    .eq('source', 'hh')
    .eq('status', 'running')
    .gte('started_at', lockSince)
    .limit(1);

  if (running && running.length > 0) {
    console.log(`[sync-hh] already running since ${running[0].started_at}, exit`);
    process.exit(0);
  }

  // ── sync_logs: старт ────────────────────────────────────────────────────────
  const { data: syncLog } = await db
    .from('sync_logs')
    .insert({ source: 'hh', status: 'running', triggered_by: null })
    .select('id')
    .single();

  const logId: string | null = syncLog?.id ?? null;

  // ── Синхронизация ───────────────────────────────────────────────────────────
  let syncResult: RunResult;
  try {
    syncResult = await runSync(db);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync-hh] FATAL error in runSync:`, err);

    await logError({ db, source: 'cron_sync_hh', severity: 'error', error_code: 'SYNC_FATAL', message: msg });
    if (logId) {
      await db.from('sync_logs').update({
        status: 'error',
        error_code: 'SYNC_FATAL',
        error_message: msg.slice(0, 1000),
        finished_at: new Date().toISOString(),
      }).eq('id', logId);
    }
    await sendAlert(fmt('🔴', 'HH Sync — КРИТИЧЕСКАЯ ОШИБКА', msg));
    process.exit(1);
  }

  // ── sync_logs: завершение ───────────────────────────────────────────────────
  const status = syncResult.errors === 0 ? 'ok' : 'partial';
  const finishedAt = new Date().toISOString();

  const errorSummary = syncResult.errorMessages.length > 0
    ? syncResult.errorMessages.slice(0, 20).join('; ').slice(0, 1000)
    : null;

  if (logId) {
    await db.from('sync_logs').update({
      status,
      records_total:   syncResult.total,
      records_updated: syncResult.updated,
      error_message:   errorSummary,
      finished_at:     finishedAt,
    }).eq('id', logId);
  }

  console.log(
    `[sync-hh] done: total=${syncResult.total} updated=${syncResult.updated} ` +
    `skipped=${syncResult.skipped} errors=${syncResult.errors} status=${status}`,
  );

  // ── Telegram: только при превышении порога или rate limit ─────────────────
  const hasRateLimit = syncResult.errorMessages.some((m) => m.includes('RATE_LIMITED'));
  if (syncResult.errors > ALERT_THRESHOLD || hasRateLimit) {
    const details = [
      `Обработано: ${syncResult.updated}/${syncResult.total}`,
      `Пропущено: ${syncResult.skipped}`,
      `Ошибок: ${syncResult.errors}`,
      hasRateLimit ? '⚠️ HH rate limit превышен' : '',
    ].filter(Boolean).join('\n');

    await sendAlert(fmt('⚠️', 'HH Sync — частичные ошибки', details));
  }

  process.exit(syncResult.errors === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[sync-hh] Uncaught error:', err);
  sendAlert(fmt(
    '🔴',
    'HH Sync — НЕОБРАБОТАННАЯ ОШИБКА',
    err instanceof Error ? err.message : String(err),
  )).finally(() => process.exit(1));
});
