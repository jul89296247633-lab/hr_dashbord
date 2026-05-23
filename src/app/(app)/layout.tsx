import { redirect } from 'next/navigation';

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
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
}
