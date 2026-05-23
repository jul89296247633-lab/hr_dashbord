import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { UsersClient } from '@/components/admin/UsersClient';

/** Управление пользователями (только admin). */
export default async function AdminUsersPage() {
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

  return <UsersClient />;
}
