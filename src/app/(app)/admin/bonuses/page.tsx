import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BonusRatesClient } from '@/components/admin/BonusRatesClient';

/** Тарифы бонусов HR — только admin. */
export default async function AdminBonusesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') redirect('/dashboard');

  return <BonusRatesClient />;
}
