import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { StaffingPlanClient } from '@/components/staffing/StaffingPlanClient';

/**
 * Штатное расписание (FEATURE_SPEC_staffing_plan.md).
 * Доступ: head, admin (CRUD) и executive (read-only). Manager — редирект.
 * Не путать со /staffing (общий % укомплектованности).
 */
export default async function StaffingPlanPage() {
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
  if (role === 'manager') redirect('/cabinet');

  return <StaffingPlanClient role={role} />;
}
