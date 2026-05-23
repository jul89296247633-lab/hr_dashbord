'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { MatchDialog } from '@/components/bonuses/MatchDialog';
import { ManagerName } from '@/components/shared/ManagerName';
import type { TeamResponse } from '@/components/dashboard/types';

interface BonusRow {
  id: string;
  manager_id: string | null;
  vacancy_id: string | null;
  vacancy_title_sheet: string;
  bonus_amount_kopecks: number;
  bonus_amount_display: string;
  bonus_date: string;
  status: 'pending' | 'paid';
  manager: { id: string; full_name: string; is_active?: boolean } | null;
  vacancy: { id: string; title: string } | null;
}
interface BonusSummary {
  total_pending_kopecks: number;
  total_paid_kopecks: number;
}

const PER_PAGE = 20;

function formatKopecks(k: number): string {
  return `${(k / 100).toLocaleString('ru-RU')} ₽`;
}

export function BonusesClient({ role }: { role: Role }) {
  const canManage = role === 'head' || role === 'admin';

  const [status, setStatus] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<BonusRow[]>([]);
  const [total, setTotal] = useState(0);
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [summary, setSummary] = useState<{ pending: number; paid: number }>({ pending: 0, paid: 0 });
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
      const qs = new URLSearchParams({ status, page: String(page), per_page: String(PER_PAGE) });
      if (managerFilter !== 'all') qs.set('manager_id', managerFilter);

      const [listRes, sumRes] = await Promise.all([
        fetch(`/api/bonuses?${qs.toString()}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
        fetch('/api/bonuses/summary?period=month').then((r) => r.json()),
      ]);
      if (!listRes.ok) throw new Error(listRes.j?.error?.message ?? 'Ошибка загрузки');

      setRows(listRes.j.data ?? []);
      setTotal(listRes.j.meta?.total ?? 0);

      const sumRows = (sumRes.data as BonusSummary[] | undefined) ?? [];
      setSummary({
        pending: sumRows.reduce((s, b) => s + b.total_pending_kopecks, 0),
        paid: sumRows.reduce((s, b) => s + b.total_paid_kopecks, 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [status, managerFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(Math.ceil(total / PER_PAGE), 1);
  const unmatchedCount = rows.filter((b) => !b.vacancy_id).length;

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-semibold">Бонусы</h1>

      {/* Сводные карточки */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Начислено за месяц" value={formatKopecks(summary.pending + summary.paid)} />
        <SummaryCard label="Выплачено" value={formatKopecks(summary.paid)} />
        <SummaryCard label="Ожидают выплаты" value={formatKopecks(summary.pending)} />
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="pending">Начислены</SelectItem>
            <SelectItem value="paid">Выплачены</SelectItem>
          </SelectContent>
        </Select>
        {canManage && managers.length > 0 && (
          <Select
            value={managerFilter}
            onValueChange={(v) => {
              setPage(1);
              setManagerFilter(v);
            }}
          >
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
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {canManage && unmatchedCount > 0 && (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>Требуется сопоставление</AlertTitle>
          <AlertDescription>
            {unmatchedCount} бонус(ов) не привязаны к вакансии — привяжите вручную.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Бонусов за выбранный период нет.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Менеджер</TableHead>
                <TableHead>Вакансия</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Статус</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id} className={cn(!b.vacancy_id && 'bg-amber-50')}>
                  <TableCell className="font-medium">
                    <ManagerName name={b.manager?.full_name} isActive={b.manager?.is_active} />
                  </TableCell>
                  <TableCell>
                    {b.vacancy ? (
                      b.vacancy.title
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="size-3.5" />
                        {b.vacancy_title_sheet}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{b.bonus_amount_display}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(`${b.bonus_date}T00:00:00`).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        b.status === 'paid'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800',
                      )}
                    >
                      {b.status === 'paid' ? 'Выплачен' : 'Начислен'}
                    </span>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {!b.vacancy_id && <MatchDialog bonusId={b.id} onMatched={load} />}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span className="text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="grid gap-1">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}
