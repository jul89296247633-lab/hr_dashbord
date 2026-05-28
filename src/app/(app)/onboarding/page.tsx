import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';

/**
 * /onboarding — мастер запуска компании через XLSX-шаблоны.
 * FEATURE_SPEC_template_upload.md.
 * Доступ: head | admin. Manager и executive → редирект на главную.
 */
export default async function OnboardingPage() {
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
  if (role === 'manager' || role === 'executive') redirect('/dashboard');

  return <OnboardingWizard />;
}
