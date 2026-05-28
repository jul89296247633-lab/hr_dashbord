'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StaffingAvailabilityResponse } from '@/types';

/**
 * Компактный виджет «штатная сверка» для встраивания в форму заявки
 * на вакансию (см. FEATURE_SPEC_vacancy_request.md). Тянет
 * /api/staffing/availability?location=<location>.
 *
 * Если по городу штат не задан — показывает дисклеймер «Штат по городу
 * не задан» (rows: []).
 */
function vacantClass(vacant: number): string {
  if (vacant > 0) return 'text-red-600 font-medium';
  if (vacant === 0) return 'text-green-600 font-medium';
  return 'text-muted-foreground';
}

export function StaffingCheckWidget({ location }: { location: string }) {
  const [data, setData] = useState<StaffingAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = location.trim();
    if (trimmed.length < 2) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    let aborted = false;
    fetch(`/api/staffing/availability?location=${encodeURIComponent(trimmed)}`)
      .then(async (res) => {
        const json = await res.json();
        if (aborted) return;
        if (!res.ok) {
          setError(json?.error?.message ?? 'Ошибка загрузки');
          setData(null);
          return;
        }
        setData(json.data as StaffingAvailabilityResponse);
      })
      .catch(() => {
        if (!aborted) setError('Ошибка загрузки');
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [location]);

  if (location.trim().length < 2) return null;
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Не удалось загрузить штат</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data || data.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Штат по городу «{location}» не задан.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-sm">
        Заполненность по «{data.location}»:
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Должность</TableHead>
            <TableHead className="text-right">План</TableHead>
            <TableHead className="text-right">Занято</TableHead>
            <TableHead className="text-right">В работе</TableHead>
            <TableHead className="text-right">Вакантно</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.position_name}>
              <TableCell className="font-medium">{r.position_name}</TableCell>
              <TableCell className="text-right tabular-nums">{r.planned}</TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {r.occupied}
              </TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {r.in_progress}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', vacantClass(r.vacant))}>
                {r.vacant}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
