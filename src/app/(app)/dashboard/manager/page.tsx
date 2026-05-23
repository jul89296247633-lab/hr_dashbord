import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { ManagerDashboard } from '@/components/dashboard/ManagerDashboard';

/** Личный дашборд менеджера (manager — свой; head/admin — выбор через Select). */
export default async function ManagerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = (profile?.role ?? 'manager') as Role;
  // executive не имеет личного дашборда — отправляем на сводный.
  if (role === 'executive') redirect('/dashboard');

  return <ManagerDashboard role={role} selfId={user.id} />;
}
