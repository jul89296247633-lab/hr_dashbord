import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { VacancyRequestsClient } from '@/components/vacancy-requests/VacancyRequestsClient';

/**
 * /requests — список заявок на открытие вакансий.
 * Доступно всем ролям. Manager видит только свои заявки (RLS).
 * head/admin/executive видят все и могут согласовывать/отклонять.
 */
export default async function RequestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  const role = (profile?.role ?? 'manager') as Role;

  // Для формы создания — только исполнители-менеджеры (не head/admin)
  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .eq('role', 'manager')
    .order('full_name');

  return (
    <VacancyRequestsClient
      role={role}
      userId={user.id}
      managers={managers ?? []}
    />
  );
}
