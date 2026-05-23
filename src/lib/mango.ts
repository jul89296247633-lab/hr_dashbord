import crypto from 'crypto';
import type { createAdminClient } from '@/lib/supabase/admin';

/**
 * Интеграция с Манго ВАТС API (SPEC §5.5a). Только серверный код.
 * Аутентификация: HMAC-SHA256 = sha256(api_key + json_body + api_salt).
 * Двухэтапный запрос: /vpbx/stats/request → key, затем /vpbx/stats/result → строки звонков.
 *
 * Считаем звонком любую исходящую попытку (от добавочного менеджера) — логика отдела.
 * Полный автосинк — cron scripts/sync-mango.ts; здесь — общий прогон для POST /api/sync/mango.
 */

const MANGO_BASE = 'https://app.mango-office.ru/vpbx';
const FIELDS = 'start,answer,from_extension,to_number,disconnect_reason';

type AdminDb = ReturnType<typeof createAdminClient>;

export interface MangoSyncResult {
  records_total: number;
  records_updated: number;
  errors: string[];
}

function mangoSign(apiKey: string, body: string, salt: string): string {
  return crypto.createHash('sha256').update(apiKey + body + salt).digest('hex');
}

async function mangoPost(path: string, body: string): Promise<unknown> {
  const apiKey = process.env.MANGO_API_KEY ?? '';
  const salt = process.env.MANGO_API_SALT ?? '';
  const res = await fetch(`${MANGO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ vpbx_api_key: apiKey, sign: mangoSign(apiKey, body, salt), json: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Mango HTTP ${res.status}`);
  return res.json();
}

/**
 * Прогон Манго-синхронизации за сегодня по менеджерам с mango_extension.
 * Пишет mango_calls_count в daily_activities (источник 'mango_api').
 */
export async function runMangoSync(db: AdminDb): Promise<MangoSyncResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateFrom = Math.floor(today.getTime() / 1000);
  const dateTo = dateFrom + 86_399;
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: managers, error } = await db
    .from('user_profiles')
    .select('id, mango_extension')
    .eq('role', 'manager')
    .eq('is_active', true)
    .not('mango_extension', 'is', null);
  if (error) throw new Error(error.message);

  const errors: string[] = [];
  let updated = 0;

  for (const m of managers ?? []) {
    try {
      const requestBody = JSON.stringify({
        date_from: dateFrom,
        date_to: dateTo,
        from: { extension: m.mango_extension },
        fields: FIELDS,
      });
      const key = await mangoPost('/stats/request', requestBody);
      const calls = await mangoPost('/stats/result', JSON.stringify(key));
      const callsCount = Array.isArray(calls) ? calls.length : 0;

      await db.from('daily_activities').upsert(
        {
          manager_id: m.id,
          activity_date: todayStr,
          mango_calls_count: callsCount,
          mango_calls_source: 'mango_api',
        },
        { onConflict: 'manager_id,activity_date' },
      );
      updated += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      errors.push(`ext=${m.mango_extension}: ${message}`);
    }
  }

  return { records_total: (managers ?? []).length, records_updated: updated, errors };
}
