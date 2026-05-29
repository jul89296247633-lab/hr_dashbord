import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser, requireRole, ApiError } from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

const INTEGRATIONS = '/admin/integrations';

/**
 * GET /api/auth/hh/callback?code=...&state=...
 *
 * HH.ru редиректит сюда после авторизации пользователя (authorization_code flow).
 * state = manager_id (UUID) — передаётся из /api/auth/hh/start.
 *
 * Алгоритм:
 * 1. Проверяем, что текущий пользователь — admin (сессия в cookies сохранилась).
 * 2. Если HH вернул error (пользователь отказал) → redirect с ?error=hh_denied.
 * 3. Меняем code на access_token + refresh_token через POST https://hh.ru/oauth/token.
 * 4. Сохраняем токены в user_profiles[state] через service_role.
 * 5. Redirect на /admin/integrations?connected=1.
 *
 * При любой ошибке → redirect на /admin/integrations?error=... (не JSON-ответ,
 * т.к. это браузерный редирект, а не fetch-запрос).
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, origin));

  try {
    // ── Аутентификация ────────────────────────────────────────────────────────
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { searchParams } = request.nextUrl;

    // HH вернул ошибку (например, пользователь отказал в авторизации)
    if (searchParams.get('error')) {
      return redirect(`${INTEGRATIONS}?error=hh_denied`);
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state'); // manager_id

    if (!code || !state || !uuidSchema.safeParse(state).success) {
      return redirect(`${INTEGRATIONS}?error=hh_invalid`);
    }

    const managerId = state;

    // ── Конфигурация ─────────────────────────────────────────────────────────
    const clientId = process.env.HH_CLIENT_ID;
    const clientSecret = process.env.HH_CLIENT_SECRET;
    const redirectUri = process.env.HH_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return redirect(`${INTEGRATIONS}?error=hh_config`);
    }

    // ── Обмен code на токены ─────────────────────────────────────────────────
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
      const errText = await tokenRes.text().catch(() => '');
      console.error('[hh-callback] token exchange failed:', tokenRes.status, errText);
      return redirect(`${INTEGRATIONS}?error=hh_oauth`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // ── Сохранение в БД ───────────────────────────────────────────────────────
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

    if (dbError) {
      throw new ApiError(500, 'DB_ERROR', dbError.message);
    }
    if (!profile) {
      return redirect(`${INTEGRATIONS}?error=hh_manager_not_found`);
    }

    return redirect(`${INTEGRATIONS}?connected=1`);
  } catch (err) {
    // Всегда делаем redirect — это браузерный endpoint, не API-fetch.
    console.error('[hh-callback] unexpected error:', err);
    return redirect(`${INTEGRATIONS}?error=hh_oauth`);
  }
}
