import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { AdminVacanciesClient } from '@/components/vacancies/AdminVacanciesClient';

/** Все вакансии (head/admin/executive) — Sheets-style таблица с inline edit. */
export default async function AdminVacanciesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles').select('role').eq('id', user.id).single();

  const role = (profile?.role ?? 'manager') as Role;
  if (role === 'manager') redirect('/vacancies');

  // Список менеджеров для фильтра и формы создания
  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .eq('role', 'manager')
    .eq('is_active', true)
    .order('full_name');

  return (
    <AdminVacanciesClient
      role={role}
      managers={(managers ?? []) as { id: string; full_name: string }[]}
    />
  );
}
