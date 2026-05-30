'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import type { Role } from '@/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StaffingCard } from '@/components/dashboard/StaffingCard';
import { PolitenessCompanyCard } from '@/components/dashboard/PolitenessCompanyCard';
import { KpiCards } from '@/components/dashboard/KpiCards';
import { TeamFunnel } from '@/components/dashboard/TeamFunnel';
import { DivisionCards } from '@/components/dashboard/DivisionCards';
import { TeamTable } from '@/components/dashboard/TeamTable';
import { MonthPicker, currentMonthYM } from '@/components/dashboard/MonthPicker';
import type {
  DashboardPeriod,
  TeamResponse,
  DivisionsResponse,
  StaffingResponse,
  PolitenessResponse,
} from '@/components/dashboard/types';

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
  return json.data as T;
}

export function DashboardClient({ role }: { role: Role }) {
  const canSeeTeam = role === 'head' || role === 'admin';
  const canEditStaffing = role === 'head' || role === 'admin';

  // По умолчанию открываем дашборд за текущий месяц (MonthPicker).
  // period='today'|'week' переключают на короткие окна, при 'month' окно
  // задаёт selectedMonth (YYYY-MM).
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthYM());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [divisions, setDivisions] = useState<DivisionsResponse | null>(null);
  const [staffing, setStaffing] = useState<StaffingResponse | null>(null);
  const [politeness, setPoliteness] = useState<PolitenessResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const divisionsPeriod = period === 'today' ? 'week' : period;
      // При period='month' прокидываем выбранный YYYY-MM в API; иначе month
      // игнорируется на серверной стороне.
      const monthQs = period === 'month' ? `&month=${selectedMonth}` : '';
      const [t, d, s, p] = await Promise.all([
        fetchData<TeamResponse>(`/api/dashboard/team?period=${period}${monthQs}`),
        fetchData<DivisionsResponse>(`/api/dashboard/divisions?period=${divisionsPeriod}${monthQs}`),
        fetchData<StaffingResponse>('/api/staffing'),
        // politeness не принимает 'today' — маппим в 'week' (review 4.5 #4).
        fetchData<PolitenessResponse>(`/api/stats/politeness?period=${divisionsPeriod}${monthQs}`),
      ]);
      setTeam(t);
      setDivisions(d);
      setStaffing(s);
      setPoliteness(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [period, selectedMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const internsTotal = (divisions?.divisions ?? []).reduce((s, d) => s + d.interns, 0);
  // Воронка отдела теперь полностью из vacancy_snapshots (SPEC §5.3):
  // Отклики / Контакты (бесплатные приглашения) / Приглашения (платные из базы) / Звонки.
  const sumFunnel = (
    key:
      | 'responses'
      | 'contacts_opened'
      | 'invitations_from_responses'
      | 'invitations_from_db'
      | 'calls',
  ) => (divisions?.divisions ?? []).reduce((s, d) => s + d.funnel[key], 0);

  const politenessById: Record<string, number | null> = {};
  for (const m of politeness?.managers ?? []) politenessById[m.manager_id] = m.politeness_index;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Дашборд отдела</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Tabs только Сегодня/Неделя. Третий режим — конкретный месяц,
              выбирается через MonthPicker (автоматически переводит в month). */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
            <TabsList>
              <TabsTrigger value="today">Сегодня</TabsTrigger>
              <TabsTrigger value="week">Неделя</TabsTrigger>
            </TabsList>
          </Tabs>
          <MonthPicker
            value={selectedMonth}
            onChange={(ym) => {
              setSelectedMonth(ym);
              setPeriod('month');
            }}
          />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StaffingCard current={staffing?.current ?? null} canEdit={canEditStaffing} onUpdated={load} />
            <PolitenessCompanyCard value={politeness?.company?.politeness_index ?? null} />
          </div>

          {team && (
            <KpiCards
              activeVacancies={team.summary.active_vacancies}
              calls={team.summary.calls}
              interviews={team.summary.interviews}
              hired={team.summary.hired}
              interns={internsTotal}
            />
          )}

          {team && (
            <TeamFunnel
              stages={[
                { label: 'Отклики', count: sumFunnel('responses') },
                { label: 'Контакты', count: sumFunnel('invitations_from_responses') },
                { label: 'Приглашения', count: sumFunnel('invitations_from_db') },
                { label: 'Звонки', count: sumFunnel('calls') },
                { label: 'Собеседования', count: team.summary.interviews.fact },
                { label: 'Стажировка', count: internsTotal },
                { label: 'Закрыто вакансий', count: team.summary.hired.fact },
              ]}
            />
          )}

          <section className="grid gap-3">
            <h2 className="text-lg font-semibold">По подразделениям</h2>
            <DivisionCards divisions={divisions?.divisions ?? []} />
          </section>

          {canSeeTeam && team && (
            <TeamTable
              managers={team.managers ?? []}
              politenessById={politenessById}
              canImpersonate={canSeeTeam}
            />
          )}
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
