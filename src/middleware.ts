import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Middleware Next.js. При использовании каталога `src/` файл обязан лежать
 * в `src/middleware.ts` (а не в корне проекта) — иначе Next его не подхватит.
 *
 * Обновляет Supabase-сессию и защищает маршруты (см. updateSession).
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Исключаем статику и файлы с расширениями — middleware работает на страницах.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
