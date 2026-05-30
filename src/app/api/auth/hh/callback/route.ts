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

    // HH вернул ошибку (пользователь отказал в авторизации)
    const hhError = searchParams.get('error');
    if (hhError) {
      return redirect(`${INTEGRATIONS}?error=hh_denied`);
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state'); // manager_id

    if (!code || !state || !uuidSchema.safeParse(state).success) {
      return redirect(`${INTEGRATIONS}?error=hh_invalid`);
    }

    const managerId = state;

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
    // Без PII (managerId/full_name) — только причина сбоя, для отладки прод-ошибок
    // OAuth (протухший code, смена redirect_uri и т.д.).
    console.error('[hh-callback] error', err instanceof Error ? err.message : err);
    return redirect(`${INTEGRATIONS}?error=hh_oauth`);
  }
}
