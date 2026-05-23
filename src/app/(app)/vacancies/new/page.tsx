import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { VacancyForm } from '@/components/vacancies/VacancyForm';

/** Создание вакансии (head, admin). */
export default async function NewVacancyPage() {
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
  if (role !== 'head' && role !== 'admin') redirect('/vacancies');

  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .eq('role', 'manager')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  return <VacancyForm mode="create" managers={managers ?? []} />;
}
