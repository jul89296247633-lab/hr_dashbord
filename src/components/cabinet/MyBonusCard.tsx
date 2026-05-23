'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Карточка «Мой бонус за месяц» для /cabinet.
 *  Источник: /api/bonuses (без параметров → текущий календарный месяц,
 *  manager-роль автоматически фильтруется по своему id в API).
 *
 *  Логика отображения:
 *   - total > 0                                       → крупная зелёная сумма
 *   - total = 0 и есть hires без тарифа               → «Тариф не настроен» серым
 *   - total = 0 и hires нет                           → «0 ₽» серым
 */
interface BonusRow {
  amount_kopecks: number | null;
}
interface BonusesResponse {
  data: BonusRow[];
  total_amount_kopecks: number;
  total_amount_display: string;
}

export function MyBonusCard() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; total: number; display: string; hasUnmatched: boolean }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/bonuses')
      .then(async (r) => {
        const j = (await r.json()) as BonusesResponse & { error?: { message?: string } };
        if (!r.ok) throw new Error(j?.error?.message ?? 'load failed');
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        const total = j.total_amount_kopecks ?? 0;
        const hasUnmatched = (j.data ?? []).some((r) => r.amount_kopecks === null);
        setState({
          kind: 'ready',
          total,
          display: j.total_amount_display ?? '0 ₽',
          hasUnmatched,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardContent className="grid gap-1">
        <div className="text-muted-foreground text-sm font-medium">Мой бонус за месяц</div>
        {state.kind === 'loading' ? (
          <Skeleton className="h-8 w-32" />
        ) : state.kind === 'error' ? (
          <div className="text-muted-foreground text-2xl font-semibold">—</div>
        ) : state.total > 0 ? (
          <div className="text-3xl font-bold text-green-600">{state.display}</div>
        ) : state.hasUnmatched ? (
          <div
            className="text-muted-foreground text-2xl font-semibold"
            title="Ни одна из ваших закрытых вакансий не сматчилась с тарифом в bonus_rates"
          >
            Тариф не настроен
          </div>
        ) : (
          <div className="text-muted-foreground text-3xl font-bold">0 ₽</div>
        )}
        <p className={cn('text-muted-foreground text-xs')}>за {currentMonthHeader()}</p>
      </CardContent>
    </Card>
  );
}

/** «Май 2026» — первая буква заглавная, без «г.». */
function currentMonthHeader(): string {
  const d = new Date();
  const month = d.toLocaleDateString('ru-RU', { month: 'long' });
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}
