'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import { toast } from 'sonner';

import type { Role, StaffingPlanRow } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  StaffingPlanRowForm,
  type StaffingPlanFormInitial,
} from '@/components/staffing/StaffingPlanRowForm';
import { StaffingPlanTable } from '@/components/staffing/StaffingPlanTable';

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
        <StaffingPlanTable
          rows={rows}
          canEdit={canEdit}
          onEdit={openEdit}
          onDelete={(r) => void handleDelete(r)}
        />
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
