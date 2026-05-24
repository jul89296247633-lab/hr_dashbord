'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Star, ChevronDown, Download } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';
import type { ManagerStatus } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ManagerName } from '@/components/shared/ManagerName';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DashboardPeriod, TeamResponse } from '@/components/dashboard/types';

// ── Локальные типы ответов (richer, чем dashboard/types) ──────────────────────
// avg_response_hours убран: в новом отчёте HH `recruitment_analytics_managers_*`
// этой колонки нет. Поле в БД остаётся nullable для исторических данных, но
// в UI больше не показывается.
interface CompanyPoliteness {
  politeness_index: number | null;
  responses_received: number | null;
  responses_viewed: number | null;
  responses_answered: number | null;
  // ⓟ Платные действия — отдельно (см. SPEC §5.3 разбивка по платным/бесплатным).
  resume_views_from_search: number | null;
  invitations_from_db: number | null;
}
interface ManagerPoliteness {
  manager_id: string;
  politeness_index: number | null;
  responses_received: number | null;
  responses_answered: number | null;
}
interface PolitenessData {
  company: CompanyPoliteness | null;
  managers: ManagerPoliteness[];
}
interface BonusSummary {
  manager_id: string;
  total_kopecks: number;
}

const STATUS: Record<ManagerStatus, { label: string; className: string }> = {
  on_track: { label: 'В плане', className: 'bg-green-100 text-green-800' },
  lagging: { label: 'Отставание', className: 'bg-yellow-100 text-yellow-800' },
  critical: { label: 'Критично', className: 'bg-red-100 text-red-800' },
};

function ivColor(iv: number): string {
  if (iv >= 85) return 'text-green-600';
  if (iv >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

function formatKopecks(k: number): string {
  return `${(k / 100).toLocaleString('ru-RU')} ₽`;
}

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
  return json.data as T;
}

export function EfficiencyClient() {
  const [period, setPeriod] = useState<DashboardPeriod>('week');
  const [managerFilter, setManagerFilter] = useState<string>('all');
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [politeness, setPoliteness] = useState<PolitenessData | null>(null);
  const [bonuses, setBonuses] = useState<BonusSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // politeness не принимает 'today' — маппим в 'week'
      // (review 4.5 #4: politeness иначе тихо отдаёт 30 дней по умолчанию).
      // Бонусы — всегда за текущий календарный месяц, независимо от селектора
      // периода страницы: они начисляются по факту найма за месяц (SPEC §5.3).
      const altPeriod = period === 'today' ? 'week' : period;
      const [t, p, b] = await Promise.all([
        fetchData<TeamResponse>(`/api/dashboard/team?period=${period}`),
        fetchData<PolitenessData>(`/api/stats/politeness?period=${altPeriod}`),
        fetchData<BonusSummary[]>(`/api/bonuses/summary?period=month`),
      ]);
      setTeam(t);
      setPoliteness(p);
      setBonuses(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const ivByManager = new Map(politeness?.managers.map((m) => [m.manager_id, m]) ?? []);
  const bonusByManager = new Map(bonuses.map((b) => [b.manager_id, b.total_kopecks]));
  const totalBonusKopecks = bonuses.reduce((s, b) => s + b.total_kopecks, 0);

  const allManagers = (team?.managers ?? []).filter((m) => m.id);
  const rows = allManagers.filter((m) => managerFilter === 'all' || m.id === managerFilter);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Эффективность менеджеров</h1>
        <Button variant="outline" size="sm" disabled>
          <Download className="size-4" />
          Экспорт CSV
        </Button>
      </div>

      {/* Фильтры */}
      <div className="bg-background sticky top-14 z-10 flex flex-wrap items-center gap-2 py-1">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
          <TabsList>
            <TabsTrigger value="today">Сегодня</TabsTrigger>
            <TabsTrigger value="week">Неделя</TabsTrigger>
            <TabsTrigger value="month">Месяц</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={managerFilter} onValueChange={setManagerFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Все менеджеры" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все менеджеры</SelectItem>
            {allManagers.map((m) => (
              <SelectItem key={m.id} value={m.id as string}>
                {m.full_name}
                {m.is_active === false ? ' (уволен)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          {/* ИВ компании */}
          {politeness?.company && politeness.company.politeness_index !== null ? (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="flex items-center gap-2 text-lg font-semibold">
                  <Star className="size-5 text-yellow-500" />
                  ИВ компании: {Math.round(politeness.company.politeness_index)}
                </span>
                <span className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  <span>Откликов: {politeness.company.responses_received ?? '—'}</span>
                  <span>
                    Просмотры (отклики): {politeness.company.responses_viewed ?? '—'}
                  </span>
                  <span title="Платное действие — менеджер сам нашёл резюме в базе HH">
                    💰 Просмотры (поиск):{' '}
                    {politeness.company.resume_views_from_search ?? '—'}
                  </span>
                  <span title="Платное действие — приглашение по контакту из базы HH">
                    💰 Приглашения из базы:{' '}
                    {politeness.company.invitations_from_db ?? '—'}
                  </span>
                  <span>Отвечено: {politeness.company.responses_answered ?? '—'}</span>
                </span>
              </CardContent>
            </Card>
          ) : (
            <Alert variant="warning">
              <AlertCircle />
              <AlertTitle>Индекс вежливости недоступен</AlertTitle>
              <AlertDescription>
                Данные об ИВ отсутствуют — загрузите CSV в разделе{' '}
                <Link href="/sync" className="underline">
                  Синхронизация
                </Link>
                .
              </AlertDescription>
            </Alert>
          )}

          {/* Таблица менеджеров */}
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Нет активностей за выбранный период.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Менеджер</TableHead>
                  <TableHead>Звонки</TableHead>
                  <TableHead>Собеседования</TableHead>
                  <TableHead>Закрыто вакансий</TableHead>
                  <TableHead>ИВ</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Бонус за месяц</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const iv = m.id ? ivByManager.get(m.id) : undefined;
                  const ivValue = iv?.politeness_index ?? null;
                  const bonusKopecks = m.id ? (bonusByManager.get(m.id) ?? 0) : 0;
                  const status = STATUS[m.status];
                  return (
                    <TableRow key={m.id ?? m.full_name}>
                      <TableCell className="font-medium">
                        <ManagerName name={m.full_name} isActive={m.is_active} />
                      </TableCell>
                      <TableCell>
                        {m.calls.fact}/{m.calls.plan} · {m.calls.pct}%
                      </TableCell>
                      <TableCell>
                        {m.interviews.fact}/{m.interviews.plan} · {m.interviews.pct}%
                      </TableCell>
                      <TableCell>
                        {m.hired.fact}/{m.hired.plan}
                      </TableCell>
                      <TableCell>
                        {typeof ivValue === 'number' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn('font-medium', ivColor(ivValue))}>
                                {Math.round(ivValue)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Ответил на {iv?.responses_answered ?? '—'} из{' '}
                              {iv?.responses_received ?? '—'}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                            status.className,
                          )}
                        >
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          bonusKopecks > 0
                            ? 'font-medium text-green-600'
                            : 'text-muted-foreground',
                        )}
                      >
                        {bonusKopecks > 0 ? formatKopecks(bonusKopecks) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Бонусы — аккордеон */}
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium [&[data-state=open]>svg]:rotate-180">
              Начисленные бонусы за период
              <ChevronDown className="size-4 transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-3">
              <div className="text-muted-foreground text-sm">
                Итого начислено:{' '}
                <span className="text-foreground font-medium">
                  {formatKopecks(totalBonusKopecks)}
                </span>
              </div>
              <Link href="/bonuses" className="mt-2 inline-block text-sm text-primary hover:underline">
                Все бонусы →
              </Link>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
