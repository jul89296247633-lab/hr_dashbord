import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { DashboardClient } from '@/components/dashboard/DashboardClient';

/** Сводный дашборд отдела (head, admin, executive). manager → личный дашборд. */
export default async function DashboardPage() {
  try {
    const supabase = await createClient();

    // Безопасная деструктуризация: при некоторых auth-сбоях getUser() возвращает
    // { data: null, error }, и `data: { user }` падает «Cannot destructure of null».
    const auth = await supabase.auth.getUser();
    const user = auth.data?.user ?? null;
    if (!user) redirect('/login');

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      console.error('[/(app)/dashboard] profile fetch failed', {
        userId: user.id,
        code: profileError.code,
        message: profileError.message,
      });
      throw new Error(`profile fetch failed: ${profileError.message}`);
    }

    const role = (profile?.role ?? 'manager') as Role;
    if (role === 'manager') redirect('/dashboard/manager');

    return <DashboardClient role={role} />;
  } catch (err) {
    // NEXT_REDIRECT — штатный механизм навигации, прокидываем как есть.
    if (isRedirectError(err)) throw err;
    console.error('[/(app)/dashboard] 500', {
      name: err instanceof Error ? err.name : 'unknown',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
