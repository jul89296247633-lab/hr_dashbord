'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, AlertCircle, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
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
import { ManagerName } from '@/components/shared/ManagerName';

const STATUS_LABEL: Record<string, string> = {
  active: 'Активна',
  paused: 'На паузе',
  closed: 'Закрыта',
  draft: 'Черновик',
};
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground',
};

interface VacancyRow {
  id: string;
  title: string;
  department: string | null;
  subdivision: string | null;
  location: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  priority: 'высокий' | 'средний' | 'низкий' | null;
  manager?: { id: string; full_name: string; is_active?: boolean } | null;
}

/**
 * Цвет ячейки «Дней в работе» — комбинация приоритета и срока:
 *   • низкий                  → серый, без иконки (заглушаем сигнал)
 *   • >30 дней                → красный + ⚠️ (критично всегда)
 *   • высокий + >14 дней      → красный + ⚠️ (эскалация для важных)
 *   • средний/без приоритета  + >14 дней → amber + ⚠️
 *   • остальное               → дефолтный muted-foreground, без иконки
 *
 * Пороги 14/30 как в /dashboard/divisions (там 45 — но HR попросил жёстче).
 */
function daysCellStyle(
  days: number,
  priority: VacancyRow['priority'],
): { className: string; showIcon: boolean } {
  if (priority === 'низкий') {
    return { className: 'text-gray-400', showIcon: false };
  }
  if (days > 30) {
    return { className: 'text-red-600', showIcon: true };
  }
  if (days > 14) {
    const isHigh = priority === 'высокий';
    return {
      className: isHigh ? 'text-red-600' : 'text-amber-600',
      showIcon: true,
    };
  }
  return { className: 'text-muted-foreground', showIcon: false };
}

/**
 * «Дней в работе»: для активных — от opened_at до сегодня,
 * для закрытых — от opened_at до closed_at. Считаем по календарным дням,
 * без учёта выходных (тот же подход, что и days_to_close в БД).
 */
function daysInWork(openedAt: string, closedAt: string | null): number | null {
  const start = new Date(`${openedAt}T00:00:00`);
  const end = closedAt ? new Date(`${closedAt}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

type SortField =
  | 'title'
  | 'subdivision'
  | 'location'
  | 'manager'
  | 'status'
  | 'opened_at'
  | 'days_in_work';
type SortDirection = 'asc' | 'desc';

const collator = new Intl.Collator('ru', { sensitivity: 'base' });

function compareByField(a: VacancyRow, b: VacancyRow, field: SortField): number {
  switch (field) {
    case 'title':
      return collator.compare(a.title, b.title);
    case 'subdivision':
      return collator.compare(a.subdivision ?? '', b.subdivision ?? '');
    case 'location':
      return collator.compare(a.location ?? '', b.location ?? '');
    case 'manager':
      return collator.compare(a.manager?.full_name ?? '', b.manager?.full_name ?? '');
    case 'status':
      return collator.compare(
        STATUS_LABEL[a.status] ?? a.status,
        STATUS_LABEL[b.status] ?? b.status,
      );
    case 'opened_at':
      // YYYY-MM-DD сравнивается лексикографически корректно.
      return a.opened_at.localeCompare(b.opened_at);
    case 'days_in_work': {
      const da = daysInWork(a.opened_at, a.closed_at) ?? -1;
      const db = daysInWork(b.opened_at, b.closed_at) ?? -1;
      return da - db;
    }
  }
}

const PER_PAGE = 20;

function SortableHeader({
  field,
  label,
  align = 'left',
  active,
  direction,
  onSort,
}: {
  field: SortField;
  label: string;
  align?: 'left' | 'right';
  active: boolean;
  direction: SortDirection;
  onSort: (field: SortField) => void;
}) {
  const Icon = active ? (direction === 'asc' ? ChevronUp : ChevronDown) : null;
  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          align === 'right' && 'justify-end',
          active && 'text-foreground',
        )}
      >
        {label}
        {Icon && <Icon className="size-3.5" />}
      </button>
    </TableHead>
  );
}

export function VacanciesList({ role }: { role: Role }) {
  const canCreate = role === 'head' || role === 'admin';
  const showManager = role !== 'executive';

  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<VacancyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Дефолт совпадает с серверным .order('opened_at', desc) — визуально без скачков.
  const [sortField, setSortField] = useState<SortField>('opened_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  // Клиентская сортировка — сортируем текущую страницу (20 строк), а не весь набор.
  // Так и просил пользователь («данные уже загружены»).
  const sortedRows = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compareByField(a, b, sortField) * sign);
  }, [rows, sortField, sortDir]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vacancies?status=${status}&page=${page}&per_page=${PER_PAGE}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(Math.ceil(total / PER_PAGE), 1);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Вакансии</h1>
        <div className="flex items-center gap-2">
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
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="paused">На паузе</SelectItem>
              <SelectItem value="closed">Закрытые</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          {canCreate && (
            <Button asChild>
              <Link href="/vacancies/new">
                <Plus className="size-4" />
                Создать вакансию
              </Link>
            </Button>
          )}
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
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Вакансий не найдено.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader field="title"        label="Название"      active={sortField === 'title'}        direction={sortDir} onSort={handleSort} />
                <SortableHeader field="subdivision"  label="Подразделение" active={sortField === 'subdivision'}  direction={sortDir} onSort={handleSort} />
                <SortableHeader field="location"     label="Город"         active={sortField === 'location'}     direction={sortDir} onSort={handleSort} />
                {showManager && (
                  <SortableHeader field="manager"    label="Менеджер"      active={sortField === 'manager'}      direction={sortDir} onSort={handleSort} />
                )}
                <SortableHeader field="status"       label="Статус"        active={sortField === 'status'}       direction={sortDir} onSort={handleSort} />
                <SortableHeader field="opened_at"    label="Открыта"       active={sortField === 'opened_at'}    direction={sortDir} onSort={handleSort} />
                <SortableHeader field="days_in_work" label="Дней в работе" align="right" active={sortField === 'days_in_work'} direction={sortDir} onSort={handleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/vacancies/${v.id}`}
                      className="block max-w-50 truncate hover:underline"
                      title={v.title}
                    >
                      {v.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{v.subdivision ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{v.location ?? '—'}</TableCell>
                  {showManager && (
                    <TableCell>
                      <ManagerName name={v.manager?.full_name} isActive={v.manager?.is_active} />
                    </TableCell>
                  )}
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        STATUS_COLOR[v.status] ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {STATUS_LABEL[v.status] ?? v.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(`${v.opened_at}T00:00:00`).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(() => {
                      const d = daysInWork(v.opened_at, v.closed_at);
                      if (d === null) return <span className="text-muted-foreground">—</span>;
                      const { className, showIcon } = daysCellStyle(d, v.priority);
                      return (
                        <span className={cn('inline-flex items-center justify-end gap-1', className)}>
                          {showIcon && <AlertTriangle className="size-3.5" />}
                          {d} д.
                        </span>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
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
