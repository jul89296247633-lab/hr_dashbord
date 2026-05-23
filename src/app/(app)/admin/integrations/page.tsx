import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { IntegrationsClient } from '@/components/admin/IntegrationsClient';

/** Токены интеграций (только admin). */
export default async function AdminIntegrationsPage() {
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
  if (profile?.role !== 'admin') redirect('/dashboard');

  return <IntegrationsClient />;
}
