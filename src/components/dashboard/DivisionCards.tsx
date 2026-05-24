'use client';

import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Division } from '@/components/dashboard/types';

/** Карточки подразделений. Клик → /dashboard/divisions?subdivision={name}. */
export function DivisionCards({ divisions }: { divisions: Division[] }) {
  if (divisions.length === 0) {
    return <p className="text-muted-foreground text-sm">Данных по подразделениям нет.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {divisions.map((d) => (
        <Link
          key={d.subdivision}
          href={`/dashboard/divisions?subdivision=${encodeURIComponent(d.subdivision)}`}
          className="block transition-opacity hover:opacity-80"
        >
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">{d.subdivision}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground grid gap-1 text-sm">
              <span>Активных вакансий: {d.active_vacancies}</span>
              <span>Закрыто вакансий за период: {d.hired_in_period}</span>
              {d.interns > 0 && <span>На стажировке: {d.interns}</span>}
              {d.avg_days_to_close !== null && (
                <span>Средний срок закрытия: {d.avg_days_to_close} дн.</span>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
