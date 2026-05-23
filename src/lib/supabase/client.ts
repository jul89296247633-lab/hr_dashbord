import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * Браузерный Supabase-клиент для Client Components.
 * Используется только для auth-событий и клиентских подписок.
 * RLS применяется автоматически по пользовательскому JWT.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
