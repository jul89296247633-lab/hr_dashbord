'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
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
 * SPEC §5.3 / §5.6: бонус = тариф из bonus_rates × vacancies (status='closed').
 * Источник — RPC compute_manager_bonuses. По умолчанию текущий месяц.
 *
 * Таблица: строка на каждую закрытую вакансию, sub-total по менеджеру (bold),
 * grand total внизу. Карточка «Начислено за месяц» — сумма матченных тарифов
 * (RPC уже возвращает amount_kopecks = NULL для нематченных, в total не входят).
 */
interface BonusRow {
  vacancy_id: string;
  manager: { id: string; full_name: string; is_active?: boolean } | null;
  vacancy: { id: string; title: string };
  closed_at: string | null;
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

function formatKopecks(k: number): string {
  return `${(k / 100).toLocaleString('ru-RU')} ₽`;
}

export function BonusesClient({ role }: { role: Role }) {
  const canManage = role === 'head' || role === 'admin';

  const [managerFilter, setManagerFilter] = useState('all');
  const [rows, setRows] = useState<BonusRow[]>([]);
  const [totalDisplay, setTotalDisplay] = useState('0 ₽');
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Группируем строки по manager_id (или 'no-manager' для безимённых).
  // Стабильный порядок: сортируем группы по фамилии manager_name.
  const groups = (() => {
    const map = new Map<
      string,
      { manager: BonusRow['manager']; rows: BonusRow[]; subtotal: number }
    >();
    for (const r of rows) {
      const key = r.manager?.id ?? 'no-manager';
      const cur = map.get(key) ?? { manager: r.manager, rows: [], subtotal: 0 };
      cur.rows.push(r);
      cur.subtotal += r.amount_kopecks ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.manager?.full_name ?? '').localeCompare(b.manager?.full_name ?? '', 'ru'),
    );
  })();

  const grandTotalKopecks = groups.reduce((s, g) => s + g.subtotal, 0);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Бонусы</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{currentMonthHeader()}</p>
      </div>

      {/* Сводная карточка: сумма матченных бонусов за месяц. */}
      <div className="grid grid-cols-1 sm:max-w-xs">
        <Card>
          <CardContent className="grid gap-1">
            <span className="text-muted-foreground text-sm">Начислено за месяц</span>
            <span className="text-2xl font-semibold">{totalDisplay}</span>
          </CardContent>
        </Card>
      </div>

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
        <p className="text-muted-foreground text-sm">Закрытых вакансий за текущий месяц нет.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead>Вакансия</TableHead>
              <TableHead>Тариф</TableHead>
              <TableHead className="text-right">Сумма бонуса</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <GroupBlock
                key={g.manager?.id ?? 'no-manager'}
                manager={g.manager}
                rows={g.rows}
                subtotal={g.subtotal}
              />
            ))}
            {/* Grand total */}
            <TableRow className="bg-muted/60 font-bold">
              <TableCell colSpan={3} className="text-right">
                Итого
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKopecks(grandTotalKopecks)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function GroupBlock({
  manager,
  rows,
  subtotal,
}: {
  manager: BonusRow['manager'];
  rows: BonusRow[];
  subtotal: number;
}) {
  return (
    <>
      {rows.map((b, i) => (
        <TableRow key={b.vacancy_id}>
          <TableCell className={cn('font-medium', i > 0 && 'text-muted-foreground')}>
            {i === 0 ? (
              <ManagerName name={manager?.full_name} isActive={manager?.is_active} />
            ) : (
              <span className="text-transparent">·</span>
            )}
          </TableCell>
          <TableCell>{b.vacancy.title}</TableCell>
          <TableCell>
            {b.rate_position_name ?? (
              <span
                className="text-muted-foreground italic"
                title="Не нашли соответствующий тариф в bonus_rates (fuzzy < 0.4)"
              >
                Тариф не задан
              </span>
            )}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {b.amount_display ?? <span className="text-muted-foreground">0 ₽</span>}
          </TableCell>
        </TableRow>
      ))}
      {/* Sub-total по менеджеру */}
      <TableRow className="bg-muted/30 font-semibold">
        <TableCell colSpan={3} className="text-right">
          Итого по {manager?.full_name ?? '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatKopecks(subtotal)}</TableCell>
      </TableRow>
    </>
  );
}

/** «Май 2026» — первая буква заглавная, без «г.». */
function currentMonthHeader(): string {
  const d = new Date();
  const month = d.toLocaleDateString('ru-RU', { month: 'long' });
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}
