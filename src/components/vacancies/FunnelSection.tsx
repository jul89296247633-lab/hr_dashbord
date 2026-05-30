'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { FunnelStage } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type FunnelPeriod = 'today' | 'week' | 'month' | 'all';

const STAGE_LABEL: Record<string, string> = {
  responses: 'Отклики',
  contacts_opened: 'Контакты',
  invitations_from_responses: 'Приглашения',
  calls: 'Звонки',
  interviews: 'Собеседования',
  interns: 'Стажировка',
  hired: 'Закрыто вакансий',
};

/** Промежуточные этапы выделяем amber-tint — визуально отличаем от
 *  «финальных» событий (выведение, отклик) и стандартного потока. */
const STAGE_TINT: Record<string, string> = {
  interns: 'border-amber-300 bg-amber-50 text-amber-900',
};

interface FunnelData {
  funnel: FunnelStage[];
  last_synced_at: string | null;
}

export function FunnelSection({
  vacancyId,
  canSync,
}: {
  vacancyId: string;
  canSync: boolean;
}) {
  const [period, setPeriod] = useState<FunnelPeriod>('month');
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vacancies/${vacancyId}/funnel?period=${period}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setData(json.data as FunnelData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки воронки');
    } finally {
      setLoading(false);
    }
  }, [vacancyId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync/hh', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка синхронизации');
      toast.success('Синхронизация HH запущена');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  }

  const noData = !loading && data?.funnel.every((s) => s.count === 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as FunnelPeriod)}>
          <TabsList>
            <TabsTrigger value="today">Сегодня</TabsTrigger>
            <TabsTrigger value="week">Неделя</TabsTrigger>
            <TabsTrigger value="month">Месяц</TabsTrigger>
            <TabsTrigger value="all">Всё время</TabsTrigger>
          </TabsList>
        </Tabs>
        {data?.last_synced_at && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <Clock className="size-3.5" />
            Данные на {new Date(data.last_synced_at).toLocaleString('ru-RU')}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {(data?.funnel ?? []).map((s, i, arr) => (
              <div key={s.stage} className="flex items-center gap-1">
                <Card className={cn('w-28 py-3', STAGE_TINT[s.stage])}>
                  <CardContent className="px-3 text-center">
                    <div className="text-2xl font-semibold leading-none">{s.count}</div>
                    <div
                      className={cn(
                        'mt-1 text-xs',
                        STAGE_TINT[s.stage] ? '' : 'text-muted-foreground',
                      )}
                    >
                      {STAGE_LABEL[s.stage] ?? s.stage}
                    </div>
                  </CardContent>
                </Card>
                {i < arr.length - 1 && (
                  <div className="flex flex-col items-center px-1">
                    <ChevronRight className="text-muted-foreground size-4" />
                    {s.conversion_pct !== null && (
                      <span className="text-muted-foreground text-xs">{s.conversion_pct}%</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {noData && (
            <Alert variant="warning">
              <RefreshCw />
              <AlertTitle>Нет данных воронки</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                Синхронизация с HH ещё не проводилась.
                {canSync && (
                  <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                    {syncing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Синхронизировать HH
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
