'use client';

import { Fragment, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { StaffingPlanRow } from '@/types';
import { Button } from '@/components/ui/button';
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function vacantClass(v: number) {
  if (v > 0) return 'text-red-600 font-medium';
  if (v === 0) return 'text-green-600 font-medium';
  return 'text-muted-foreground';
}

function pluralRows(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} строка`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} строки`;
  return `${n} строк`;
}

function sumBy(
  rows: StaffingPlanRow[],
  key: 'planned' | 'occupied' | 'in_progress' | 'vacant',
): number {
  return rows.reduce((acc, r) => acc + r[key], 0);
}

interface CityGroup {
  city: string;
  rows: StaffingPlanRow[];
}

export interface StaffingPlanTableProps {
  rows: StaffingPlanRow[];
  canEdit: boolean;
  onEdit: (row: StaffingPlanRow) => void;
  onDelete: (row: StaffingPlanRow) => void;
}

export function StaffingPlanTable({ rows, canEdit, onEdit, onDelete }: StaffingPlanTableProps) {
  const [cityFilter, setCityFilter] = useState<string>('all');

  const cities = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.city))).sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    [rows],
  );

  const visibleRows = useMemo(
    () => (cityFilter === 'all' ? rows : rows.filter((r) => r.city === cityFilter)),
    [rows, cityFilter],
  );

  // Группировка видимых строк по городу, алфавитный порядок
  const groups = useMemo<CityGroup[]>(() => {
    const map = new Map<string, StaffingPlanRow[]>();
    for (const r of visibleRows) {
      const list = map.get(r.city) ?? [];
      list.push(r);
      map.set(r.city, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ru'))
      .map(([city, cityRows]) => ({ city, rows: cityRows }));
  }, [visibleRows]);

  // Итого по всем видимым строкам — пересчитывается при смене фильтра
  const total = useMemo(
    () => ({
      count: visibleRows.length,
      planned: sumBy(visibleRows, 'planned'),
      occupied: sumBy(visibleRows, 'occupied'),
      in_progress: sumBy(visibleRows, 'in_progress'),
      vacant: sumBy(visibleRows, 'vacant'),
    }),
    [visibleRows],
  );

  // Подытоги по городу показываем только когда видно больше одного города
  const showCitySubtotals = groups.length > 1;

  return (
    <div className="grid gap-3">
      {/* Фильтр по городу — только когда городов > 1 */}
      {cities.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Фильтр по городу:</span>
          <Select value={cityFilter} onValueChange={setCityFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все города</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Город</TableHead>
              <TableHead>Должность</TableHead>
              <TableHead className="text-right">План</TableHead>
              <TableHead className="text-right">Занято</TableHead>
              <TableHead className="text-right">В работе</TableHead>
              <TableHead className="text-right">Вакантно</TableHead>
              <TableHead>Комментарий</TableHead>
              {canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>

          <TableBody>
            {groups.map(({ city, rows: cityRows }) => {
              const ct = {
                planned: sumBy(cityRows, 'planned'),
                occupied: sumBy(cityRows, 'occupied'),
                in_progress: sumBy(cityRows, 'in_progress'),
                vacant: sumBy(cityRows, 'vacant'),
              };

              return (
                <Fragment key={city}>
                  {/* Строки данных */}
                  {cityRows.map((r, idx) => (
                    <TableRow key={r.id}>
                      {/* Название города — только у первой строки группы */}
                      <TableCell className="font-medium">{idx === 0 ? r.city : ''}</TableCell>
                      <TableCell className="font-medium">{r.position_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.planned}</TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {r.occupied}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {r.in_progress}
                      </TableCell>
                      <TableCell
                        className={cn('text-right tabular-nums', vacantClass(r.vacant))}
                      >
                        {r.vacant}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground max-w-50 truncate"
                        title={r.comment ?? ''}
                      >
                        {r.comment ?? '—'}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(r)}
                            aria-label="Изменить"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(r)}
                            aria-label="Удалить"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}

                  {/* Подытог по городу */}
                  {showCitySubtotals && (
                    <TableRow className="bg-muted/40 text-sm">
                      <TableCell colSpan={2} className="font-semibold text-muted-foreground">
                        Итого по {city}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {ct.planned}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {ct.occupied}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {ct.in_progress}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums font-semibold',
                          vacantClass(ct.vacant),
                        )}
                      >
                        {ct.vacant}
                      </TableCell>
                      <TableCell />
                      {canEdit && <TableCell />}
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>

          {/* Итоговая строка: пересчитывается по видимым строкам */}
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">ИТОГО</TableCell>
              <TableCell className="text-muted-foreground text-sm font-normal">
                {pluralRows(total.count)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{total.planned}</TableCell>
              <TableCell className="text-right tabular-nums">{total.occupied}</TableCell>
              <TableCell className="text-right tabular-nums">{total.in_progress}</TableCell>
              <TableCell className={cn('text-right tabular-nums', vacantClass(total.vacant))}>
                {total.vacant}
              </TableCell>
              <TableCell />
              {canEdit && <TableCell />}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
