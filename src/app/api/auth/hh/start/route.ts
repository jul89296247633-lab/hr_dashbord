import { type NextRequest, NextResponse } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  handleApiError,
} from '@/lib/api-helpers';
import { uuidSchema } from '@/lib/validations';

/**
 * GET /api/auth/hh/start?manager_id=UUID
 *
 * Формирует URL авторизации HH.ru (authorization_code flow) и редиректит браузер на HH.
 * Только для admin — запускается кликом по кнопке «Подключить через HH» на /admin/integrations.
 *
 * State = manager_id: после авторизации HH вернёт его в callback, и мы привяжем токен
 * к конкретному менеджеру.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const managerId = request.nextUrl.searchParams.get('manager_id');
    if (!managerId || !uuidSchema.safeParse(managerId).success) {
      return apiError('VALIDATION_ERROR', 'Параметр manager_id обязателен и должен быть UUID', 422);
    }

    const clientId = process.env.HH_CLIENT_ID;
    const redirectUri = process.env.HH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return apiError(
        'CONFIG_ERROR',
        'HH OAuth не настроен: отсутствует HH_CLIENT_ID или HH_REDIRECT_URI в переменных окружения',
        500,
      );
    }

    const authUrl = new URL('https://hh.ru/oauth/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', managerId);

    return NextResponse.redirect(authUrl.toString());
  } catch (err) {
    return handleApiError(err);
  }
}
