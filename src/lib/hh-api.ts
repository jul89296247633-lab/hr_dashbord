import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * Интеграция с HH.ru API v3 (SPEC §5.4). Только серверный код.
 * Аутентификация: Bearer {hh_access_token} менеджера-владельца вакансии.
 *
 * Полный автосинк — cron scripts/sync-hh.ts. Здесь — переиспользуемая логика
 * для on-demand запуска из POST /api/sync/hh.
 */

const HH_BASE = 'https://api.hh.ru';

type AdminDb = ReturnType<typeof createAdminClient>;

interface HhVacancy {
  status?: { id?: string };
  counters?: {
    responses?: number;
    views?: number;
    invitations?: number;
    discards?: number;
  };
}

export interface HhSyncResult {
  records_total: number;
  records_updated: number;
  phone_calls_updated: number;
  errors: string[];
}

/**
 * Запрос статистики вакансии с ретраями. Разделяем 404 и прочие сбои:
 * 404 = вакансия удалена/архивирована на HH → авто-закрытие в БД (EC-03);
 * 'failed' = сетевые сбои/5xx после ретраев → лог в errors без изменения статуса.
 */
type FetchResult =
  | { kind: 'ok'; data: HhVacancy }
  | { kind: 'not_found' }
  | { kind: 'failed' };

async function fetchVacancyStats(token: string, hhVacancyId: string): Promise<FetchResult> {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i < delays.length; i += 1) {
    try {
      const res = await fetch(`${HH_BASE}/vacancies/${hhVacancyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return { kind: 'ok', data: (await res.json()) as HhVacancy };
      if (res.status === 404) return { kind: 'not_found' };
    } catch {
      // сетевой сбой — уйдём на ретрай
    }
    if (i < delays.length - 1) await new Promise((r) => setTimeout(r, delays[i]));
  }
  return { kind: 'failed' };
}

interface HhPhoneCall {
  id?: number | string;
  status?: string;
  creation_time?: string;
  last_change_time?: string | null;
  duration_seconds?: number | null;
}

interface HhNegotiationWithCalls {
  id?: number | string;
  phone_calls?: {
    picked_up_phone_by_opponent?: boolean | null;
    items?: HhPhoneCall[];
  };
}

interface HhPhoneCallsResponse {
  items?: HhNegotiationWithCalls[];
  pages?: number;
}

type PhoneCallsResult =
  | { kind: 'ok'; calls: Array<HhPhoneCall & { negotiation_id: string | null; picked_up_phone_by_opponent: boolean | null }> }
  | { kind: 'not_available' }
  | { kind: 'failed' };

async function fetchPhoneCalls(token: string, hhVacancyId: string): Promise<PhoneCallsResult> {
  const callsById = new Map<
    string,
    HhPhoneCall & { negotiation_id: string | null; picked_up_phone_by_opponent: boolean | null }
  >();

  for (let page = 0; page < 50; page += 1) {
    const url = `${HH_BASE}/negotiations/phone_calls?${new URLSearchParams({
      vacancy_id: hhVacancyId,
      page: String(page),
      per_page: '100',
    })}`;

    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403 || res.status === 404) return { kind: 'not_available' };
      if (!res.ok) return { kind: 'failed' };

      const data = (await res.json()) as HhPhoneCallsResponse;
      for (const item of data.items ?? []) {
        const negotiationId = item.id == null ? null : String(item.id);
        const pickedUp = item.phone_calls?.picked_up_phone_by_opponent ?? null;
        for (const call of item.phone_calls?.items ?? []) {
          if (call.id == null || !call.status || !call.creation_time) continue;
          callsById.set(String(call.id), {
            ...call,
            negotiation_id: negotiationId,
            picked_up_phone_by_opponent: pickedUp,
          });
        }
      }

      if (data.pages == null || page >= data.pages - 1) break;
    } catch {
      return { kind: 'failed' };
    }
  }

  return { kind: 'ok', calls: Array.from(callsById.values()) };
}

async function upsertPhoneCalls(
  db: AdminDb,
  vacancy: { id: string; hh_vacancy_id: string; manager_id: string | null },
  calls: Array<HhPhoneCall & { negotiation_id: string | null; picked_up_phone_by_opponent: boolean | null }>,
): Promise<number> {
  if (calls.length === 0) return 0;

  const rows = calls.map((call) => ({
    hh_call_id: String(call.id),
    vacancy_id: vacancy.id,
    hh_vacancy_id: vacancy.hh_vacancy_id,
    manager_id: vacancy.manager_id,
    negotiation_id: call.negotiation_id,
    status: call.status ?? 'unknown',
    creation_time: call.creation_time!,
    last_change_time: call.last_change_time ?? null,
    duration_seconds: call.duration_seconds ?? null,
    picked_up_phone_by_opponent: call.picked_up_phone_by_opponent,
    raw_json: {
      id: call.id,
      status: call.status,
      creation_time: call.creation_time!,
      last_change_time: call.last_change_time ?? null,
      duration_seconds: call.duration_seconds ?? null,
      negotiation_id: call.negotiation_id,
      picked_up_phone_by_opponent: call.picked_up_phone_by_opponent,
    },
    synced_at: new Date().toISOString(),
  }));

  const { error } = await db.from('hh_phone_calls').upsert(rows, { onConflict: 'hh_call_id' });
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Обновляет OAuth-токены менеджера через refresh_token. true при успехе. */
async function refreshHhToken(
  db: AdminDb,
  managerId: string,
  refreshToken: string | null,
): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch('https://hh.ru/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.HH_CLIENT_ID ?? '',
      client_secret: process.env.HH_CLIENT_SECRET ?? '',
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  await db
    .from('user_profiles')
    .update({
      hh_access_token: data.access_token,
      hh_refresh_token: data.refresh_token,
      hh_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    })
    .eq('id', managerId);
  return true;
}

interface VacancyManager {
  is_active: boolean;
  hh_access_token: string | null;
  hh_refresh_token: string | null;
  hh_token_expires_at: string | null;
}

/**
 * Прогон HH-синхронизации по активным вакансиям с hh_vacancy_id.
 * Для каждой: при необходимости рефрешит токен, тянет counters, пишет vacancy_snapshots.
 *
 * EC-03: HH вернул 404 → авто-закрытие вакансии (status='closed', closed_at=today),
 *        пушим 'AUTO_CLOSED' в errors (это штатная ситуация, не сбой).
 * EC-08: менеджер уволен (is_active=false) → пропускаем + 'SKIPPED_INACTIVE_MANAGER'
 *        (бизнес-правило: head должен переназначить вакансию вручную через UI).
 * Управление sync_logs — на стороне роута.
 */
export async function runHhSync(db: AdminDb): Promise<HhSyncResult> {
  const { data: vacancies, error } = await db
    .from('vacancies')
    .select(
      'id, hh_vacancy_id, manager_id, manager:user_profiles!vacancies_manager_id_fkey(is_active, hh_access_token, hh_refresh_token, hh_token_expires_at)',
    )
    .eq('status', 'active')
    .not('hh_vacancy_id', 'is', null);
  if (error) throw new Error(error.message);

  const errors: string[] = [];
  let updated = 0;
  let phoneCallsUpdated = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const v of vacancies ?? []) {
    const manager = v.manager as VacancyManager | null;
    if (!v.hh_vacancy_id) continue;

    // EC-08: вакансия активна, но менеджер уволен — сигнал переназначить, не синхронизируем.
    if (!manager || !manager.is_active) {
      errors.push(`SKIPPED_INACTIVE_MANAGER vacancy_id=${v.id}`);
      continue;
    }

    if (!v.manager_id) continue; // конфиденциальные/черновики без менеджера — пропускаем

    let token = manager.hh_access_token;
    if (!token) {
      errors.push(`HH_TOKEN_MISSING manager_id=${v.manager_id}`);
      continue;
    }

    // Рефреш токена если истекает в ближайшие 24 часа.
    const expiresAt = manager.hh_token_expires_at ? new Date(manager.hh_token_expires_at) : null;
    if (expiresAt && expiresAt < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
      const ok = await refreshHhToken(db, v.manager_id, manager.hh_refresh_token);
      if (!ok) {
        errors.push(`HH_TOKEN_EXPIRED manager_id=${v.manager_id}`);
        continue;
      }
      const { data: fresh } = await db
        .from('user_profiles')
        .select('hh_access_token')
        .eq('id', v.manager_id)
        .maybeSingle();
      token = fresh?.hh_access_token ?? token;
    }

    const result = await fetchVacancyStats(token, v.hh_vacancy_id);

    // EC-03: 404 → авто-закрытие вакансии (вакансия удалена/архивирована на HH).
    if (result.kind === 'not_found') {
      await db
        .from('vacancies')
        .update({ status: 'closed', closed_at: todayStr })
        .eq('id', v.id);
      errors.push(`AUTO_CLOSED hh_vacancy_id=${v.hh_vacancy_id}`);
      continue;
    }
    if (result.kind === 'failed') {
      errors.push(`FETCH_FAILED hh_vacancy_id=${v.hh_vacancy_id}`);
      continue;
    }

    const stats = result.data;
    let callsCount: number | null = null;
    const phoneCalls = await fetchPhoneCalls(token, v.hh_vacancy_id);
    if (phoneCalls.kind === 'ok') {
      callsCount = phoneCalls.calls.length;
      try {
        phoneCallsUpdated += await upsertPhoneCalls(db, {
          id: v.id,
          hh_vacancy_id: v.hh_vacancy_id,
          manager_id: v.manager_id,
        }, phoneCalls.calls);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`PHONE_CALLS_UPSERT_FAILED hh_vacancy_id=${v.hh_vacancy_id}: ${message}`);
      }
    } else if (phoneCalls.kind === 'failed') {
      errors.push(`PHONE_CALLS_FETCH_FAILED hh_vacancy_id=${v.hh_vacancy_id}`);
    }

    if (stats.status?.id === 'archived') {
      await db
        .from('vacancies')
        .update({ status: 'closed', closed_at: todayStr })
        .eq('id', v.id);
    }

    await db.from('vacancy_snapshots').insert({
      vacancy_id: v.id,
      responses_count: stats.counters?.responses ?? 0,
      views_count: stats.counters?.views ?? 0,
      invitations_from_responses: stats.counters?.invitations ?? 0,
      calls_count: callsCount,
      source: 'hh_api',
    });
    updated += 1;
  }

  return {
    records_total: vacancies?.length ?? 0,
    records_updated: updated,
    phone_calls_updated: phoneCallsUpdated,
    errors,
  };
}
