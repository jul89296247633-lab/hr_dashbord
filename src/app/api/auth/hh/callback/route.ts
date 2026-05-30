import { type NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

const INTEGRATIONS = '/admin/integrations';
const NONCE_COOKIE = 'hh_oauth_nonce';

/**
 * GET /api/auth/hh/callback?code=...&state=...
 *
 * HH.ru редиректит сюда после авторизации (authorization_code flow).
 * state = одноразовый nonce (SEC-007), выданный в /api/auth/hh/start.
 *
 * Намеренно НЕ проверяем сессию через getAuthUser() (браузер возвращается с
 * hh.ru, SSR-cookies сессии могут быть недоступны). CSRF-защита:
 *  - state(URL) должен совпасть с nonce из httpOnly-cookie (привязка к браузеру);
 *  - связка nonce -> manager_id берётся из hh_oauth_states (server-side), с TTL;
 *  - nonce одноразовый: удаляется из БД сразу после сверки, cookie гасится.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const redirect = (path: string) => {
    const res = NextResponse.redirect(new URL(path, origin));
    res.cookies.set(NONCE_COOKIE, '', { path: '/api/auth/hh', maxAge: 0 }); // гасим cookie в любом исходе
    return res;
  };

  try {
    const { searchParams } = request.nextUrl;

    // HH вернул ошибку (пользователь отказал в авторизации)
    const hhError = searchParams.get('error');
    if (hhError) {
      return redirect(`${INTEGRATIONS}?error=hh_denied`);
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state'); // nonce
    const cookieNonce = request.cookies.get(NONCE_COOKIE)?.value;

    // CSRF-проверка №1: state(URL) == nonce(httpOnly-cookie) И валидный UUID.
    if (
      !code ||
      !state ||
      !uuidSchema.safeParse(state).success ||
      !cookieNonce ||
      cookieNonce !== state
    ) {
      return redirect(`${INTEGRATIONS}?error=hh_invalid`);
    }

    const db = createAdminClient();

    // CSRF-проверка №2: запись nonce есть в БД. Удаляем СРАЗУ после нахождения
    // (одноразовость — защита от повторного использования), затем проверяем срок.
    const { data: stateRow } = await db
      .from('hh_oauth_states')
      .select('manager_id, expires_at')
      .eq('nonce', state)
      .maybeSingle();
    if (stateRow) {
      await db.from('hh_oauth_states').delete().eq('nonce', state);
    }
    // CSRF-проверка №3: запись существует И не истекла (expires_at > now()).
    if (!stateRow || new Date(stateRow.expires_at) < new Date()) {
      return redirect(`${INTEGRATIONS}?error=hh_invalid`);
    }
    const managerId = stateRow.manager_id; // из БД-записи, НЕ из URL

    // ── Конфигурация ──────────────────────────────────────────────────────────
    const clientId = process.env.HH_CLIENT_ID?.trim();
    const clientSecret = process.env.HH_CLIENT_SECRET?.trim();
    const redirectUri = process.env.HH_REDIRECT_URI?.trim();

    if (!clientId || !clientSecret || !redirectUri) {
      return redirect(`${INTEGRATIONS}?error=hh_config`);
    }

    // ── Обмен code на токены ──────────────────────────────────────────────────
    const tokenRes = await fetch('https://hh.ru/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      return redirect(`${INTEGRATIONS}?error=hh_oauth`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // ── Сохранение в БД через service_role ───────────────────────────────────
    const { data: profile, error: dbError } = await db
      .from('user_profiles')
      .update({
        hh_access_token: tokenData.access_token,
        hh_refresh_token: tokenData.refresh_token,
        hh_token_expires_at: expiresAt,
      })
      .eq('id', managerId)
      .select('id, full_name')
      .maybeSingle();

    if (dbError) {
      throw new ApiError(500, 'DB_ERROR', dbError.message);
    }
    if (!profile) {
      return redirect(`${INTEGRATIONS}?error=hh_manager_not_found`);
    }

    return redirect(`${INTEGRATIONS}?connected=1`);
  } catch (err) {
    // Без PII (managerId/full_name) — только причина сбоя, для отладки прод-ошибок
    // OAuth (протухший code, смена redirect_uri и т.д.).
    console.error('[hh-callback] error', err instanceof Error ? err.message : err);
    return redirect(`${INTEGRATIONS}?error=hh_oauth`);
  }
}
