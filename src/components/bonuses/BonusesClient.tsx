'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import type { Role } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
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
import { ManagerName } from '@/components/shared/ManagerName';
import type { TeamResponse } from '@/components/dashboard/types';

/**
 * SPEC §5.3 / §5.6: бонус = тариф из bonus_rates × hired_employees (status='hired').
 * Источник — RPC compute_manager_bonuses. По умолчанию показываем текущий месяц.
 */
interface BonusRow {
  hired_id: string;
  manager: { id: string; full_name: string; is_active?: boolean } | null;
  vacancy: { id: string; title: string } | null;
  position_name: string;
  hired_date: string;
  rate_position_name: string | null;
  amount_kopecks: number | null;
  amount_display: string | null;
}
interface BonusesResponse {
  data: BonusRow[];
  total_amount_kopecks: number;
  total_amount_display: string;
  meta: { from: string; to: string; total: number };
}

export function BonusesClient({ role }: { role: Role }) {
  const canManage = role === 'head' || role === 'admin';

  const [managerFilter, setManagerFilter] = useState('all');
  const [rows, setRows] = useState<BonusRow[]>([]);
  const [totalDisplay, setTotalDisplay] = useState('0 ₽');
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Менеджеры для фильтра (head/admin).
  useEffect(() => {
    if (!canManage) return;
    fetch('/api/dashboard/team?period=month')
      .then((r) => r.json())
      .then((j) => {
        const t = j.data as TeamResponse | undefined;
        setManagers(
          (t?.managers ?? [])
            .filter((m) => m.id && m.full_name)
            .map((m) => ({ id: m.id as string, full_name: m.full_name as string })),
        );
      })
      .catch(() => setManagers([]));
  }, [canManage]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (managerFilter !== 'all') qs.set('manager_id', managerFilter);
      const url = `/api/bonuses${qs.toString() ? `?${qs}` : ''}`;
      const res = await fetch(url);
      const json = (await res.json()) as BonusesResponse & {
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');

      setRows(json.data ?? []);
      setTotalDisplay(json.total_amount_display ?? '0 ₽');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [managerFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Бонусы</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{currentMonthHeader()}</p>
      </div>

      {/* Сводная карточка: сумма начислений за текущий месяц.
          total_amount_kopecks из API уже исключает строки без тарифа (NULL → 0). */}
      <div className="grid grid-cols-1 sm:max-w-xs">
        <Card>
          <CardContent className="grid gap-1">
            <span className="text-muted-foreground text-sm">Начислено за месяц</span>
            <span className="text-2xl font-semibold">{totalDisplay}</span>
          </CardContent>
        </Card>
      </div>

      {/* Фильтр: только менеджеры (head/admin). */}
      {canManage && managers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Все менеджеры" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все менеджеры</SelectItem>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Бонусов за текущий месяц нет.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead>Вакансия</TableHead>
              <TableHead>Тариф</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.hired_id}>
                <TableCell className="font-medium">
                  <ManagerName name={b.manager?.full_name} isActive={b.manager?.is_active} />
                </TableCell>
                <TableCell>{b.vacancy?.title ?? '—'}</TableCell>
                <TableCell>
                  {b.rate_position_name ?? (
                    <span
                      className="text-muted-foreground italic"
                      title="Не нашли соответствующий тариф в bonus_rates (fuzzy < 0.6)"
                    >
                      Тариф не задан
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {b.amount_display ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** «Май 2026» — первая буква заглавная, без «г.». */
function currentMonthHeader(): string {
  const d = new Date();
  const month = d.toLocaleDateString('ru-RU', { month: 'long' });
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}
