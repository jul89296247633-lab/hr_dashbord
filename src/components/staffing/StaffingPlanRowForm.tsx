'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Форма add/edit плановой единицы (head/admin). Один компонент для обоих
 * режимов — режим определяется по наличию `initial.id`.
 *
 * - city / position_name — datalist-автоподсказки (HTML5 native). Для редакта
 *   эти поля disabled (UNIQUE-ключ — менять нельзя; для смены пары надо
 *   удалить и пересоздать).
 * - planned_units — число 0..999.
 * - comment — до 500 символов, nullable.
 */
export interface StaffingPlanFormInitial {
  id?: string;
  city?: string;
  position_name?: string;
  planned_units?: number;
  comment?: string | null;
}

export function StaffingPlanRowForm({
  open,
  onOpenChange,
  initial,
  cities,
  positions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: StaffingPlanFormInitial;
  cities: string[];
  positions: string[];
  onSaved: () => void;
}) {
  const isEdit = Boolean(initial?.id);

  const [city, setCity] = useState('');
  const [positionName, setPositionName] = useState('');
  const [plannedUnits, setPlannedUnits] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Сброс / hydrate состояния при открытии или смене initial.
  useEffect(() => {
    if (!open) return;
    setCity(initial?.city ?? '');
    setPositionName(initial?.position_name ?? '');
    setPlannedUnits(initial?.planned_units ?? 0);
    setComment(initial?.comment ?? '');
  }, [open, initial]);

  async function handleSubmit() {
    const trimmedCity = city.trim();
    const trimmedPosition = positionName.trim();
    if (trimmedCity.length < 2) {
      toast.error('Город — минимум 2 символа');
      return;
    }
    if (trimmedPosition.length < 2) {
      toast.error('Должность — минимум 2 символа');
      return;
    }
    if (!Number.isInteger(plannedUnits) || plannedUnits < 0 || plannedUnits > 999) {
      toast.error('План — целое число от 0 до 999');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/staffing/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: trimmedCity,
          position_name: trimmedPosition,
          planned_units: plannedUnits,
          comment: comment.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения');
        return;
      }
      toast.success(isEdit ? 'План обновлён' : 'План добавлен');
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Изменить плановую единицу' : 'Добавить в штатное расписание'}</DialogTitle>
          <DialogDescription>
            Город матчится с vacancies.location, должность — с bonus_rates.position_name.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="city">Город</Label>
            <Input
              id="city"
              list="staffing-plan-cities"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={isEdit}
              placeholder="Например, Сочи"
              maxLength={100}
            />
            <datalist id="staffing-plan-cities">
              {cities.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="position">Должность</Label>
            <Input
              id="position"
              list="staffing-plan-positions"
              value={positionName}
              onChange={(e) => setPositionName(e.target.value)}
              disabled={isEdit}
              placeholder="Например, Продавец-консультант"
              maxLength={200}
            />
            <datalist id="staffing-plan-positions">
              {positions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="planned-units">Кол-во единиц (план)</Label>
            <Input
              id="planned-units"
              type="number"
              min={0}
              max={999}
              value={plannedUnits}
              onChange={(e) => setPlannedUnits(Number(e.target.value))}
            />
            <p className="text-muted-foreground text-xs">
              «Занято» больше не вводится вручную — считается автоматически из
              привязанных вакансий.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="comment">Комментарий</Label>
            <Textarea
              id="comment"
              rows={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: открытие ТЦ Моремолл"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
