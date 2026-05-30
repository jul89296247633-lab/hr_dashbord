import { type NextRequest, NextResponse } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  handleApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validations';

const NONCE_COOKIE = 'hh_oauth_nonce';

/**
 * GET /api/auth/hh/start?manager_id=UUID
 *
 * Формирует URL авторизации HH.ru (authorization_code flow), редиректит браузер на HH.
 * Только для admin — кнопка «Подключить через HH» на /admin/integrations.
 *
 * CSRF-защита (SEC-007): state = одноразовый КРИПТО-случайный nonce
 * (gen_random_uuid() — DEFAULT столбца hh_oauth_states.nonce). Связку
 * nonce -> manager_id храним server-side в hh_oauth_states; сам nonce — в
 * httpOnly-cookie. Callback сверит state(URL) == nonce(cookie) и достанет
 * manager_id из БД.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const managerId = request.nextUrl.searchParams.get('manager_id');
    if (!managerId || !uuidSchema.safeParse(managerId).success) {
      return apiError('VALIDATION_ERROR', 'Параметр manager_id обязателен и должен быть UUID', 422);
    }

    const clientId = process.env.HH_CLIENT_ID?.trim();
    const redirectUri = process.env.HH_REDIRECT_URI?.trim();
    if (!clientId || !redirectUri) {
      return apiError(
        'CONFIG_ERROR',
        'HH OAuth не настроен: отсутствует HH_CLIENT_ID или HH_REDIRECT_URI в переменных окружения',
        500,
      );
    }

    const db = createAdminClient();

    // Оптоочистка протухших nonce (без cron — таблица крошечная, admin-инициирует).
    await db.from('hh_oauth_states').delete().lt('expires_at', new Date().toISOString());

    // Одноразовый крипто-случайный nonce (gen_random_uuid() — DEFAULT столбца).
    // Наружу (в state) уходит только nonce; связка с manager_id остаётся в БД.
    const { data: row, error } = await db
      .from('hh_oauth_states')
      .insert({ manager_id: managerId })
      .select('nonce')
      .single();
    if (error || !row) {
      return apiError('DB_ERROR', 'Не удалось инициализировать OAuth-сессию', 500);
    }

    const authUrl = new URL('https://hh.ru/oauth/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', row.nonce); // state = nonce, НЕ manager_id

    const res = NextResponse.redirect(authUrl.toString());
    res.cookies.set(NONCE_COOKIE, row.nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax', // lax → cookie дойдёт при top-level redirect обратно с hh.ru
      path: '/api/auth/hh',
      maxAge: 600, // 10 минут = TTL nonce в hh_oauth_states
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
