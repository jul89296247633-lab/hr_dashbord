import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, ArrowLeft, Timer, Pencil } from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FunnelSection } from '@/components/vacancies/FunnelSection';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL: Record<string, string> = {
  active: 'Активна',
  paused: 'На паузе',
  closed: 'Закрыта',
  draft: 'Черновик',
};
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground',
};

function NotFoundCard() {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <AlertCircle className="text-muted-foreground size-8" />
        <p className="font-medium">Вакансия не найдена</p>
        <Button asChild variant="outline">
          <Link href="/vacancies">
            <ArrowLeft className="size-4" />К списку
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export async function VacancyDetailView({ id }: { id: string }) {
  if (!UUID_RE.test(id)) return <NotFoundCard />;

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
  const canEdit = role === 'head' || role === 'admin';

  // RLS вернёт пусто для чужой вакансии менеджера → 404.
  const { data: vacancy } = await supabase
    .from('vacancies')
    .select(
      'id, title, status, opened_at, closed_at, days_to_close, department, subdivision, manager:user_profiles!vacancies_manager_id_fkey(id, full_name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!vacancy) return <NotFoundCard />;

  const daysBadge =
    vacancy.closed_at && vacancy.days_to_close !== null
      ? `Закрыта за ${vacancy.days_to_close} дн.`
      : `Открыта ${daysSince(vacancy.opened_at)} дн.`;

  return (
    <div className="grid gap-6">
      {/* Breadcrumb */}
      <div className="text-muted-foreground flex items-center gap-1 text-sm">
        <Link href="/vacancies" className="hover:underline">
          Вакансии
        </Link>
        <span>/</span>
        <span className="text-foreground">{vacancy.title}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">{vacancy.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                STATUS_COLOR[vacancy.status] ?? 'bg-muted text-muted-foreground',
              )}
            >
              {STATUS_LABEL[vacancy.status] ?? vacancy.status}
            </span>
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Timer className="size-3.5" />
              {daysBadge}
            </span>
            {vacancy.subdivision && (
              <span className="text-muted-foreground">· {vacancy.subdivision}</span>
            )}
            {vacancy.manager && (
              <span className="text-muted-foreground">· {vacancy.manager.full_name}</span>
            )}
          </div>
        </div>
        {canEdit && (
          <Button asChild variant="outline">
            <Link href={`/vacancies/${vacancy.id}/edit`}>
              <Pencil className="size-4" />
              Редактировать
            </Link>
          </Button>
        )}
      </div>

      <FunnelSection vacancyId={vacancy.id} canSync={canEdit} />
    </div>
  );
}

function daysSince(dateStr: string): number {
  return Math.max(
    Math.round((Date.now() - new Date(`${dateStr}T00:00:00`).getTime()) / 86_400_000),
    0,
  );
}
