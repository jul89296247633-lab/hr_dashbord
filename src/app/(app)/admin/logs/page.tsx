import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { LogsClient } from '@/components/admin/LogsClient';

/** Журналы: audit trail и error logs (только admin). */
export default async function AdminLogsPage() {
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

  return <LogsClient />;
}
