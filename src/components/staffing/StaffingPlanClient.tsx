'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { Role, StaffingPlanRow } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  StaffingPlanRowForm,
  type StaffingPlanFormInitial,
} from '@/components/staffing/StaffingPlanRowForm';

/** Цвет «Вакантно»: >0 красный (нужно нанимать), =0 зелёный, <0 серый (превышение плана). */
function vacantClass(vacant: number): string {
  if (vacant > 0) return 'text-red-600 font-medium';
  if (vacant === 0) return 'text-green-600 font-medium';
  return 'text-muted-foreground';
}

interface CityGroup {
  city: string;
  rows: StaffingPlanRow[];
  totalPlanned: number;
  totalVacant: number;
}

function groupByCity(rows: StaffingPlanRow[]): CityGroup[] {
  const map = new Map<string, CityGroup>();
  for (const r of rows) {
    const g = map.get(r.city) ?? { city: r.city, rows: [], totalPlanned: 0, totalVacant: 0 };
    g.rows.push(r);
    g.totalPlanned += r.planned;
    g.totalVacant += r.vacant;
    map.set(r.city, g);
  }
  return Array.from(map.values()).sort((a, b) => a.city.localeCompare(b.city, 'ru'));
}

export function StaffingPlanClient({ role }: { role: Role }) {
  const canEdit = role === 'head' || role === 'admin';

  const [rows, setRows] = useState<StaffingPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Опции автоподсказок — грузим только если canEdit (executive не редактирует).
  const [cities, setCities] = useState<string[]>([]);
  const [positions, setPositions] = useState<string[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffingPlanFormInitial | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/staffing/plan');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows((json.data as StaffingPlanRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    if (!canEdit) return;
    try {
      const res = await fetch('/api/staffing/plan/options');
      const json = await res.json();
      if (!res.ok) return; // тихо — datalist опционален
      setCities(json.data?.cities ?? []);
      setPositions(json.data?.positions ?? []);
    } catch {
      // тихо
    }
  }, [canEdit]);

  useEffect(() => {
    void load();
    void loadOptions();
  }, [load, loadOptions]);

  const groups = useMemo(() => groupByCity(rows), [rows]);

  function openAdd() {
    setEditing(undefined);
    setFormOpen(true);
  }
  function openEdit(r: StaffingPlanRow) {
    setEditing({
      id: r.id,
      city: r.city,
      position_name: r.position_name,
      planned_units: r.planned,
      occupied_units: r.occupied,
      comment: r.comment,
    });
    setFormOpen(true);
  }

  async function handleDelete(r: StaffingPlanRow) {
    if (!confirm(`Удалить «${r.position_name}» в городе «${r.city}»?`)) return;
    try {
      const res = await fetch(`/api/staffing/plan/${r.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Не удалось удалить');
        return;
      }
      toast.success('Удалено');
      void load();
    } catch {
      toast.error('Не удалось удалить');
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Штатное расписание</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            План единиц по городам и должностям. Заполненность считается на лету.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openAdd}>
            <Plus className="size-4" />
            Добавить позицию
          </Button>
        )}
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
        <Card>
          <CardContent className="grid place-items-center gap-3 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              Штатное расписание ещё не задано.
            </p>
            {canEdit && (
              <Button onClick={openAdd}>
                <Plus className="size-4" />
                Добавить первую позицию
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5">
          {groups.map((g) => (
            <details key={g.city} open className="rounded-md border">
              <summary className="hover:bg-muted/50 flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                <span className="font-semibold">{g.city}</span>
                <span className="text-muted-foreground text-sm">
                  Позиций: {g.rows.length} · План: {g.totalPlanned} · Вакантно:{' '}
                  <span className={vacantClass(g.totalVacant)}>{g.totalVacant}</span>
                </span>
              </summary>
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {g.rows.map((r) => (
                    <TableRow key={r.id}>
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
                      <TableCell className="text-muted-foreground max-w-50 truncate" title={r.comment ?? ''}>
                        {r.comment ?? '—'}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(r)}
                            aria-label="Изменить"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleDelete(r)}
                            aria-label="Удалить"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          ))}
        </div>
      )}

      {canEdit && (
        <StaffingPlanRowForm
          open={formOpen}
          onOpenChange={setFormOpen}
          initial={editing}
          cities={cities}
          positions={positions}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
