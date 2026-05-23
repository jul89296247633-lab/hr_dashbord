'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DivisionsPeriod = 'week' | 'month' | 'quarter';

const VACANCY_STATUS: Record<string, string> = {
  active: 'Активна',
  paused: 'На паузе',
  closed: 'Закрыта',
  draft: 'Черновик',
};

interface FunnelMini {
  responses: number;
  contacts_opened: number;
  invitations_sent: number;
  hired: number;
  interns: number;
}
interface DivisionVacancy {
  id: string;
  title: string;
  manager: { id: string; full_name: string } | null;
  status: string;
  days_open: number;
  funnel_mini: FunnelMini;
}
interface Division {
  subdivision: string;
  active_vacancies: number;
  closed_in_period: number;
  avg_days_to_close: number | null;
  interns: number;
  hired_in_period: number;
  funnel: FunnelMini;
  vacancies: DivisionVacancy[];
}
interface DivisionsResponse {
  period: string;
  divisions: Division[];
}

async function fetchData<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
  return json.data as T;
}

export function DivisionsClient({ initialSubdivision }: { initialSubdivision: string | null }) {
  const [period, setPeriod] = useState<DivisionsPeriod>('month');
  const [subdivision, setSubdivision] = useState<string>(initialSubdivision ?? 'all');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchData<DivisionsResponse>(`/api/dashboard/divisions?period=${period}`);
      setDivisions(data.divisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const allNames = divisions.map((d) => d.subdivision);
  const shown = subdivision === 'all' ? divisions : divisions.filter((d) => d.subdivision === subdivision);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Аналитика по подразделениям</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={subdivision} onValueChange={setSubdivision}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Все подразделения" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все подразделения</SelectItem>
              {allNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as DivisionsPeriod)}>
            <TabsList>
              <TabsTrigger value="week">Неделя</TabsTrigger>
              <TabsTrigger value="month">Месяц</TabsTrigger>
              <TabsTrigger value="quarter">Квартал</TabsTrigger>
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

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет вакансий по выбранному подразделению.</p>
      ) : (
        <div className="grid gap-3">
          {shown.map((d) => (
            <DivisionRow key={d.subdivision} division={d} />
          ))}
        </div>
      )}
    </div>
  );
}

function DivisionRow({ division: d }: { division: Division }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-4 px-4 py-3 text-left text-sm [&[data-state=open]>svg]:rotate-180">
        <span className="flex-1 font-medium">{d.subdivision}</span>
        <span className="text-muted-foreground hidden sm:block">Активных: {d.active_vacancies}</span>
        <span className="text-muted-foreground hidden sm:block">Закрыто: {d.closed_in_period}</span>
        <span className="text-muted-foreground hidden md:block">
          Ср. срок: {d.avg_days_to_close !== null ? `${d.avg_days_to_close} дн.` : '—'}
        </span>
        <span className="text-muted-foreground hidden md:block">Стажёров: {d.interns}</span>
        <ChevronDown className="size-4 shrink-0 transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-3">
        {/* Воронка-агрегат подразделения */}
        <div className="text-muted-foreground mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>Отклики: {d.funnel.responses}</span>
          <span>Контакты: {d.funnel.contacts_opened}</span>
          <span>Приглашения: {d.funnel.invitations_sent}</span>
          <span>Стажировка: {d.funnel.interns}</span>
          <span>Трудоустройство: {d.funnel.hired}</span>
        </div>

        {d.vacancies.length === 0 ? (
          <p className="text-muted-foreground text-sm">Нет вакансий.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Менеджер</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Дней открыта</TableHead>
                <TableHead>Воронка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.vacancies.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.title}</TableCell>
                  <TableCell>{v.manager?.full_name ?? '—'}</TableCell>
                  <TableCell>{VACANCY_STATUS[v.status] ?? v.status}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        v.days_open > 45 && 'text-amber-600',
                      )}
                    >
                      {v.days_open > 45 && <AlertTriangle className="size-3.5" />}
                      {v.days_open}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    R:{v.funnel_mini.responses} → C:{v.funnel_mini.contacts_opened} → I:
                    {v.funnel_mini.invitations_sent} → Найм:{v.funnel_mini.hired}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
