import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { DashboardClient } from '@/components/dashboard/DashboardClient';

/** Сводный дашборд отдела (head, admin, executive). manager → личный дашборд. */
export default async function DashboardPage() {
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
  if (role === 'manager') redirect('/dashboard/manager');

  return <DashboardClient role={role} />;
}
