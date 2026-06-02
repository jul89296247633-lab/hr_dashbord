import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { VacancyForm } from '@/components/vacancies/VacancyForm';

/** Редактирование вакансии (head, admin). */
export default async function EditVacancyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const [{ data: managers }, { data: vacancy }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('role', 'manager')
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('vacancies')
      .select('id, title, subdivision, manager_id, hh_vacancy_id, opened_at, status')
      .eq('id', id)
      .maybeSingle(),
  ]);

  if (!vacancy) redirect('/vacancies');

  return (
    <VacancyForm
      mode="edit"
      vacancyId={vacancy.id}
      managers={managers ?? []}
      initial={{
        title: vacancy.title,
        subdivision: vacancy.subdivision ?? '',
        manager_id: vacancy.manager_id ?? undefined,
        hh_vacancy_id: vacancy.hh_vacancy_id ?? '',
        opened_at: vacancy.opened_at,
        status: vacancy.status as 'active' | 'paused' | 'closed' | 'draft',
      }}
    />
  );
}
