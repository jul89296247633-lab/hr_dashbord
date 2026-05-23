'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { PlanDialog, type PlanValues } from '@/components/plan/PlanDialog';

const DEFAULT_PLAN: PlanValues = {
  calls_per_day: 15,
  interviews_per_day: 5,
  hires_per_month: 15,
  vacancies_limit: 5,
};

interface PlanRow extends PlanValues {
  manager_id: string;
  effective_from: string;
}

export function PlanClient({ managers }: { managers: { id: string; full_name: string }[] }) {
  const [plans, setPlans] = useState<Record<string, PlanRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/plans');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      const map: Record<string, PlanRow> = {};
      for (const p of (json.data ?? []) as PlanRow[]) map[p.manager_id] = p;
      setPlans(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (managers.length === 0) {
    return (
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Планы менеджеров</h1>
        <Alert>
          <AlertCircle />
          <AlertTitle>Нет менеджеров</AlertTitle>
          <AlertDescription>
            Добавьте менеджеров в разделе Администрирование → Пользователи.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-semibold">Планы менеджеров</h1>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead>Звонков/день</TableHead>
              <TableHead>Собеседований/день</TableHead>
              <TableHead>Выводов/мес</TableHead>
              <TableHead>Лимит вакансий</TableHead>
              <TableHead>Действует с</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {managers.map((m) => {
              const plan = plans[m.id];
              const values: PlanValues = plan ?? DEFAULT_PLAN;
              const isDefault = !plan;
              return (
                <TableRow key={m.id} className={cn(isDefault && 'text-muted-foreground')}>
                  <TableCell className="text-foreground font-medium">{m.full_name}</TableCell>
                  <TableCell>{values.calls_per_day}</TableCell>
                  <TableCell>{values.interviews_per_day}</TableCell>
                  <TableCell>{values.hires_per_month}</TableCell>
                  <TableCell>{values.vacancies_limit}</TableCell>
                  <TableCell>
                    {plan
                      ? new Date(`${plan.effective_from}T00:00:00`).toLocaleDateString('ru-RU')
                      : 'по умолчанию'}
                  </TableCell>
                  <TableCell className="text-right">
                    <PlanDialog
                      managerId={m.id}
                      managerName={m.full_name}
                      current={values}
                      onSaved={load}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
