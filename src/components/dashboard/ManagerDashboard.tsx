'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Phone, Users, UserCheck, Briefcase, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Role, ManagerStatus, KpiMetricWithStatus } from '@/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DashboardPeriod, TeamResponse } from '@/components/dashboard/types';
import { ManagerName } from '@/components/shared/ManagerName';

interface ByDay {
  date: string;
  calls: number;
  interviews: number;
  hired: number;
}
interface ManagerDashboardData {
  manager: { id: string; full_name: string; is_active?: boolean };
  period: string;
  kpi: { calls: KpiMetricWithStatus; interviews: KpiMetricWithStatus; hires: KpiMetricWithStatus };
  active_vacancies_count: number;
  by_day: ByDay[];
}

const STATUS: Record<ManagerStatus, { label: string; badge: string; bar: string }> = {
  on_track: { label: 'В плане', badge: 'bg-green-100 text-green-800', bar: 'bg-green-500' },
  lagging: { label: 'Отставание', badge: 'bg-yellow-100 text-yellow-800', bar: 'bg-yellow-500' },
  critical: { label: 'Критично', badge: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
};

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
  return json.data as T;
}

export function ManagerDashboard({ role, selfId }: { role: Role; selfId: string }) {
  const canPick = role === 'head' || role === 'admin';

  const [period, setPeriod] = useState<DashboardPeriod>('week');
  const [managers, setManagers] = useState<
    { id: string; full_name: string; is_active?: boolean }[]
  >([]);
  const [managerId, setManagerId] = useState<string>(canPick ? '' : selfId);
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Список менеджеров для head/admin (из сводного дашборда).
  useEffect(() => {
    if (!canPick) return;
    fetchData<TeamResponse>('/api/dashboard/team?period=week')
      .then((t) => {
        const list = (t.managers ?? [])
          .filter((m) => m.id && m.full_name)
          .map((m) => ({
            id: m.id as string,
            full_name: m.full_name as string,
            is_active: m.is_active,
          }));
        setManagers(list);
        setManagerId((cur) => cur || list[0]?.id || '');
      })
      .catch(() => setManagers([]));
  }, [canPick]);

  const load = useCallback(async () => {
    if (!managerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ period });
      if (managerId !== selfId) qs.set('manager_id', managerId);
      setData(await fetchData<ManagerDashboardData>(`/api/dashboard/manager?${qs.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [managerId, period, selfId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {data ? (
            <ManagerName name={data.manager.full_name} isActive={data.manager.is_active} />
          ) : (
            'Личный дашборд'
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {canPick && managers.length > 0 && (
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Выберите менеджера" />
              </SelectTrigger>
              <SelectContent>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                    {m.is_active === false ? ' (уволен)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
            <TabsList>
              <TabsTrigger value="today">Сегодня</TabsTrigger>
              <TabsTrigger value="week">Неделя</TabsTrigger>
              <TabsTrigger value="month">Месяц</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {canPick && !managerId && !loading ? (
        <p className="text-muted-foreground text-sm">Выберите менеджера для просмотра.</p>
      ) : loading ? (
        <ManagerSkeleton />
      ) : data ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Briefcase className="text-muted-foreground size-4" />
            Активных вакансий: <span className="font-medium">{data.active_vacancies_count}</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KpiCard icon={Phone} label="Звонки" metric={data.kpi.calls} />
            <KpiCard icon={Users} label="Собеседования" metric={data.kpi.interviews} />
            <KpiCard icon={UserCheck} label="Выведено" metric={data.kpi.hires} />
          </div>

          <Card>
            <CardContent>
              <h2 className="mb-3 text-base font-semibold">По дням</h2>
              {data.by_day.length === 0 ? (
                <p className="text-muted-foreground text-sm">Нет активностей за выбранный период.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Звонки</TableHead>
                      <TableHead>Собеседования</TableHead>
                      <TableHead>Выведено</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_day.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell className="font-medium">
                          {new Date(`${d.date}T00:00:00`).toLocaleDateString('ru-RU')}
                        </TableCell>
                        <TableCell>{d.calls}</TableCell>
                        <TableCell>{d.interviews}</TableCell>
                        <TableCell>{d.hired}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  metric,
}: {
  icon: LucideIcon;
  label: string;
  metric: KpiMetricWithStatus;
}) {
  const status = STATUS[metric.status];
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4" />
            {label}
          </span>
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', status.badge)}>
            {status.label}
          </span>
        </div>
        <div className="text-2xl font-semibold">
          {metric.fact}
          <span className="text-muted-foreground text-base"> / {metric.plan}</span>
          <span className="text-muted-foreground ml-2 text-sm">{metric.pct}%</span>
        </div>
        <Progress value={Math.min(metric.pct, 100)} indicatorClassName={status.bar} />
      </CardContent>
    </Card>
  );
}

function ManagerSkeleton() {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
