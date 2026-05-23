import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { ReportClient } from '@/components/ai/ReportClient';

/** Еженедельный AI-отчёт (head, admin). */
export default async function ReportPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
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

  return <ReportClient week={week} />;
}
