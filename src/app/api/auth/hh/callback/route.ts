import { type NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

const INTEGRATIONS = '/admin/integrations';

/**
 * GET /api/auth/hh/callback?code=...&state=...
 *
 * HH.ru редиректит сюда после авторизации (authorization_code flow).
 * state = manager_id (UUID), передаётся из /api/auth/hh/start.
 *
 * Намеренно НЕ проверяем сессию через getAuthUser():
 * - Браузер возвращается с hh.ru, и SSR-cookies могут быть недоступны
 *   в момент обработки редиректа (Next.js 15 edge behaviour).
 * - Безопасность обеспечивается иначе: code одноразовый и принимается
 *   только на зарегистрированный redirect_uri; state = manager_id
 *   непредсказуем снаружи; инициировать flow может только admin.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const redirect = (path: string) => NextResponse.redirect(new URL(path, origin));

  try {
    const { searchParams } = request.nextUrl;
    console.log('[hh-callback] step=start', {
      hasCode: !!searchParams.get('code'),
      hasState: !!searchParams.get('state'),
      hasError: !!searchParams.get('error'),
    });

    // HH вернул ошибку (пользователь отказал в авторизации)
    const hhError = searchParams.get('error');
    if (hhError) {
      console.log('[hh-callback] step=hh_error', { hhError });
      return redirect(`${INTEGRATIONS}?error=hh_denied`);
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state'); // manager_id

    if (!code || !state || !uuidSchema.safeParse(state).success) {
      console.log('[hh-callback] step=invalid_params', { code: !!code, state, validUuid: state ? uuidSchema.safeParse(state).success : false });
      return redirect(`${INTEGRATIONS}?error=hh_invalid`);
    }

    const managerId = state;
    console.log('[hh-callback] step=params_ok', { managerId });

    // ── Конфигурация ──────────────────────────────────────────────────────────
    const clientId = process.env.HH_CLIENT_ID?.trim();
    const clientSecret = process.env.HH_CLIENT_SECRET?.trim();
    const redirectUri = process.env.HH_REDIRECT_URI?.trim();
    console.log('[hh-callback] step=env', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRedirectUri: !!redirectUri,
      redirectUri,
    });

    if (!clientId || !clientSecret || !redirectUri) {
      console.error('[hh-callback] step=env_missing');
      return redirect(`${INTEGRATIONS}?error=hh_config`);
    }

    // ── Обмен code на токены ──────────────────────────────────────────────────
    console.log('[hh-callback] step=token_exchange_start');
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
    console.log('[hh-callback] step=token_exchange_done', { status: tokenRes.status, ok: tokenRes.ok });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      console.error('[hh-callback] step=token_exchange_failed', { status: tokenRes.status, body: errText });
      return redirect(`${INTEGRATIONS}?error=hh_oauth`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    console.log('[hh-callback] step=token_received', { expires_in: tokenData.expires_in, hasAccessToken: !!tokenData.access_token, hasRefreshToken: !!tokenData.refresh_token });

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // ── Сохранение в БД через service_role ───────────────────────────────────
    console.log('[hh-callback] step=db_update_start', { managerId });
    const db = createAdminClient();
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
    console.log('[hh-callback] step=db_update_done', { profile: profile?.full_name ?? null, dbError: dbError?.message ?? null });

    if (dbError) {
      throw new ApiError(500, 'DB_ERROR', dbError.message);
    }
    if (!profile) {
      console.error('[hh-callback] step=manager_not_found', { managerId });
      return redirect(`${INTEGRATIONS}?error=hh_manager_not_found`);
    }

    console.log('[hh-callback] step=success', { managerId, fullName: profile.full_name });
    return redirect(`${INTEGRATIONS}?connected=1`);
  } catch (err) {
    console.error('[hh-callback] step=catch', err);
    return redirect(`${INTEGRATIONS}?error=hh_oauth`);
  }
}
