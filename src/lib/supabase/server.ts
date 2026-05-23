import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Серверный Supabase-клиент для Server Components и Route Handlers.
 * Уважает RLS — работает под пользовательским JWT из cookie.
 *
 * Next.js 15: cookies() асинхронна, поэтому функция возвращает Promise.
 * Используется паттерн getAll/setAll из @supabase/ssr.
 *
 * TODO: после `supabase gen types` параметризовать createServerClient<Database>.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Вызов из Server Component, где запись cookie запрещена.
            // Сессию обновляет middleware — здесь можно безопасно игнорировать.
          }
        },
      },
    },
  );
}
