import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { StaffingClient } from '@/components/staffing/StaffingClient';

/** Укомплектованность отдела. Все видят; head/admin могут обновлять. */
export default async function StaffingPage() {
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
  const canEdit = role === 'head' || role === 'admin';

  return <StaffingClient canEdit={canEdit} />;
}
