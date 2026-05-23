import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { CallsSource, Role } from '@/types';
import { CabinetClient } from '@/components/cabinet/CabinetClient';
import type { CabinetActivity, CabinetPlan } from '@/components/cabinet/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EDIT_WINDOW_DAYS = 30; // override SPEC §5.2 (было 7)
const DEFAULT_PLAN: CabinetPlan = { calls_per_day: 15, interviews_per_day: 5 };

/**
 * Серверная загрузка данных кабинета за дату: профиль менеджера, активность, активный план.
 * Зеркалит GET /api/activities/[date] + GET /api/plans (читает напрямую через RLS-клиент).
 */
export async function CabinetView({ date }: { date: string }) {
  if (!DATE_RE.test(date)) redirect('/cabinet');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, mango_extension, hh_manager_id')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  const role = profile.role as Role;

  // Активность за дату.
  const { data: row } = await supabase
    .from('daily_activities')
    .select('*')
    .eq('manager_id', user.id)
    .eq('activity_date', date)
    .maybeSingle();

  const activity: CabinetActivity = {
    mango_calls_count: row?.mango_calls_count ?? null,
    mango_calls_source: (row?.mango_calls_source ?? 'pending') as CallsSource,
    hh_calls_count: row?.hh_calls_count ?? null,
    hh_calls_source: (row?.hh_calls_source ?? 'pending') as CallsSource,
    interviews_count: row?.interviews_count ?? 0,
    offers_count: row?.offers_count ?? 0,
    notes: row?.notes ?? null,
    total_calls: (row?.mango_calls_count ?? 0) + (row?.hh_calls_count ?? 0),
    exists: Boolean(row),
  };

  // Активный план (последний effective_from ≤ сегодня).
  const today = new Date().toISOString().slice(0, 10);
  const { data: plans } = await supabase
    .from('manager_plans')
    .select('calls_per_day, interviews_per_day, effective_from, created_at')
    .eq('manager_id', user.id)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const plan: CabinetPlan = plans?.[0]
    ? { calls_per_day: plans[0].calls_per_day, interviews_per_day: plans[0].interviews_per_day }
    : DEFAULT_PLAN;

  // Редактируемость: не будущее и (для manager) не старше 30 дней.
  const editable = isEditable(date, role);

  return (
    <CabinetClient
      date={date}
      editable={editable}
      mangoActive={profile.mango_extension !== null}
      hhActive={profile.hh_manager_id !== null}
      plan={plan}
      activity={activity}
    />
  );
}

function isEditable(date: string, role: Role): boolean {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const reqDate = new Date(`${date}T00:00:00`);

  if (reqDate.getTime() > start.getTime()) return false; // будущее
  if (role === 'manager') {
    const oldest = new Date(start);
    oldest.setDate(start.getDate() - EDIT_WINDOW_DAYS);
    if (reqDate.getTime() < oldest.getTime()) return false; // старше 30 дней
  }
  return true;
}
