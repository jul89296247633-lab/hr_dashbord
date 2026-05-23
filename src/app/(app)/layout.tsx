import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { createClient } from '@/lib/supabase/server';
import { navItemsForRole } from '@/lib/nav';
import type { Role } from '@/types';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { Header } from '@/components/layout/Header';

/**
 * Защищённый layout с sidebar. Серверно проверяет сессию и роль,
 * передаёт в клиентские компоненты только сериализуемые данные (role, full_name).
 * Дублирует guard middleware на случай прямого рендера.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const supabase = await createClient();

    // Безопасная деструктуризация: при auth-сбоях data может быть null.
    const auth = await supabase.auth.getUser();
    const user = auth.data?.user ?? null;
    if (!user) redirect('/login');

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, full_name, is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      console.error('[/(app)/layout] profile fetch failed', {
        userId: user.id,
        code: profileError.code,
        message: profileError.message,
      });
      throw new Error(`profile fetch failed: ${profileError.message}`);
    }

    if (!profile || !profile.is_active) {
      // signOut() — HTTP-вызов в Auth API; сетевой сбой не должен ронять страницу.
      // Сессию всё равно подчистит middleware при следующем рендере /login.
      try {
        await supabase.auth.signOut();
      } catch (signOutErr) {
        console.error('[/(app)/layout] signOut failed (non-fatal)', {
          userId: user.id,
          message: signOutErr instanceof Error ? signOutErr.message : String(signOutErr),
        });
      }
      redirect('/login');
    }

    const role = profile.role as Role;
    const items = navItemsForRole(role);

    return (
      <div className="grid min-h-screen md:grid-cols-[16rem_1fr]">
        {/* Desktop sidebar */}
        <aside className="bg-sidebar text-sidebar-foreground hidden flex-col border-r md:flex">
          <div className="flex h-14 items-center border-b px-6 font-semibold">HR Control Tower</div>
          <div className="flex-1 overflow-y-auto py-3">
            <SidebarNav items={items} />
          </div>
        </aside>

        {/* Контент */}
        <div className="flex min-w-0 flex-col">
          <Header role={role} fullName={profile.full_name} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    );
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error('[/(app)/layout] 500', {
      name: err instanceof Error ? err.name : 'unknown',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
