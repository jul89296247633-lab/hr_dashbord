import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/api-helpers';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { Header } from '@/components/layout/Header';
import { ImpersonationBanner } from '@/components/layout/ImpersonationBanner';

/**
 * Защищённый layout с sidebar. Использует getAuthContext → ЭФФЕКТИВНАЯ identity:
 * при активной impersonation весь shell (nav/header) показывает менеджера + баннер.
 * Данные везде берутся из API, которые тоже эффективны (getAuthUser) — admin-only
 * API при impersonation вернут 403, утечки нет.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getAuthContext();
  } catch (err) {
    if (isRedirectError(err)) throw err;
    // Нет валидной сессии / деактивирован → чистим сессию (без петли) и на /login.
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      /* сетевой сбой signOut не должен ронять редирект */
    }
    redirect('/login');
  }

  const { user, impersonating } = ctx;
  const role = user.role; // эффективная роль (менеджер при impersonation)

  return (
    <div className="grid min-h-screen md:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground hidden flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-6 font-semibold">HR Control Tower</div>
        <div className="flex-1 overflow-y-auto py-3">
          <SidebarNav role={role} />
        </div>
      </aside>

      {/* Контент */}
      <div className="flex min-w-0 flex-col">
        {impersonating && <ImpersonationBanner managerName={user.full_name} />}
        <Header role={role} fullName={user.full_name} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
