import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { PlanClient } from '@/components/plan/PlanClient';

/** Настройка планов KPI по менеджерам (head, admin). */
export default async function PlanPage() {
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
  if (role !== 'head' && role !== 'admin') redirect('/dashboard');

  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .eq('role', 'manager')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  return <PlanClient managers={managers ?? []} />;
}
