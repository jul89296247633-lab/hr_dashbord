import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Обновляет Supabase-сессию и выполняет защиту маршрутов + ролевые redirect'ы.
 *
 * Логика:
 *  - неавторизованный на любой странице (кроме /login) → /login;
 *  - авторизованный на /login → его домашняя страница по роли;
 *  - авторизованный на / → /cabinet (manager) или /dashboard (head/executive/admin);
 *  - /api/* — пропускаются (роуты сами отвечают 401 JSON, без redirect'ов).
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // ВАЖНО: getUser() (не getSession) — проверяет токен на сервере Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // API-маршруты не редиректим — они сами возвращают 401/403 в JSON.
  if (path.startsWith('/api')) {
    return supabaseResponse;
  }

  const isLogin = path === '/login';

  // Неавторизован и не на /login → на страницу входа.
  if (!user && !isLogin) {
    return redirectTo(request, '/login', supabaseResponse);
  }

  // Авторизован на /login или на корне → на домашнюю страницу по роли.
  if (user && (isLogin || path === '/')) {
    const home = await resolveHomePath(supabase, user.id);
    return redirectTo(request, home, supabaseResponse);
  }

  return supabaseResponse;
}

/** Домашний маршрут по роли пользователя. */
async function resolveHomePath(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .single();

  return profile?.role === 'manager' ? '/cabinet' : '/dashboard';
}

/**
 * Redirect с переносом cookie, выставленных Supabase на supabaseResponse,
 * чтобы обновлённая сессия не потерялась при перенаправлении.
 */
function redirectTo(
  request: NextRequest,
  pathname: string,
  fromResponse: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';

  const redirect = NextResponse.redirect(url);
  fromResponse.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie.name, cookie.value);
  });
  return redirect;
}
