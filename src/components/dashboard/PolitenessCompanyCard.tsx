import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

/** Карточка «Индекс вежливости компании» — на /dashboard рядом со StaffingCard.
 *  Источник: /api/stats/politeness → company.politeness_index (weighted average
 *  по менеджерам в текущем периоде). NULL → «—» + подсказка про CSV. */
export function PolitenessCompanyCard({ value }: { value: number | null }) {
  const display = value !== null ? `${Math.round(value)}%` : '—';
  const colorClass =
    value === null
      ? 'text-muted-foreground'
      : value >= 90
        ? 'text-green-600'
        : value >= 70
          ? 'text-yellow-600'
          : 'text-red-600';

  return (
    <Card>
      <CardContent>
        <div className="text-muted-foreground text-sm font-medium">
          Индекс вежливости компании
        </div>
        <div className={cn('text-6xl font-bold', colorClass)}>{display}</div>
        {value === null && (
          <p className="text-muted-foreground mt-1 text-sm">
            Загрузите CSV в «Синхронизация»
          </p>
        )}
      </CardContent>
    </Card>
  );
}
