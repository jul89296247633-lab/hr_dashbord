import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Service-role клиент Supabase. ОБХОДИТ RLS — только серверный код.
 * SUPABASE_SERVICE_ROLE_KEY никогда не должен попадать в браузер (CLAUDE.md).
 *
 * Применение в API-слое строго после проверки прав (getAuthUser + requireRole):
 * например /api/dashboard/team, где роль executive по RLS не видит
 * daily_activities/user_profiles, но должна получать обезличенные агрегаты (EC-09).
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
