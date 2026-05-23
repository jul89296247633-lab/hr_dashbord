import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { DivisionsClient } from '@/components/dashboard/DivisionsClient';

/** Аналитика по подразделениям (head, admin, executive). */
export default async function DivisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ subdivision?: string }>;
}) {
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

  const { subdivision } = await searchParams;
  return <DivisionsClient initialSubdivision={subdivision ?? null} />;
}
