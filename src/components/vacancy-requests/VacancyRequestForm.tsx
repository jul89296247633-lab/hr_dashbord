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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StaffingCheckWidget } from '@/components/staffing/StaffingCheckWidget';

interface Manager {
  id: string;
  full_name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  managers: Manager[];
  currentUserId: string;
  currentRole: string;
  onCreated: () => void;
}

/**
 * Форма создания заявки на вакансию.
 * При выборе города отображает StaffingCheckWidget — штатную сверку из фичи 1.
 * Превышение плана предупреждает, но не блокирует (FEATURE_SPEC §5).
 */
export function VacancyRequestForm({
  open,
  onOpenChange,
  managers,
  currentUserId,
  currentRole,
  onCreated,
}: Props) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [subdivision, setSubdivision] = useState('');
  const [managerId, setManagerId] = useState<string>('');
  const [openedAt, setOpenedAt] = useState(new Date().toISOString().slice(0, 10));
  const [requestReason, setRequestReason] = useState('');
  const [confidentiality, setConfidentiality] = useState<'open' | 'confidential'>('open');
  const [customerName, setCustomerName] = useState('');
  const [positionsCount, setPositionsCount] = useState(1);
  const [priority, setPriority] = useState<'' | 'высокий' | 'средний' | 'низкий'>('');
  const [options, setOptions] = useState<{ titles: string[]; locations: string[]; subdivisions: string[] }>(
    { titles: [], locations: [], subdivisions: [] },
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setLocation('');
    setSubdivision('');
    setManagerId(currentRole === 'manager' ? currentUserId : '');
    setOpenedAt(new Date().toISOString().slice(0, 10));
    setRequestReason('');
    setConfidentiality('open');
    setCustomerName('');
    setPositionsCount(1);
    setPriority('');
  }, [open, currentUserId, currentRole]);

  // Автодополнение: уникальные значения из существующих вакансий (datalist).
  useEffect(() => {
    if (!open) return;
    fetch('/api/vacancies/requests/options')
      .then((r) => r.json())
      .then((j) => setOptions(j.data ?? { titles: [], locations: [], subdivisions: [] }))
      .catch(() => { /* автодополнение необязательно */ });
  }, [open]);

  async function handleSubmit() {
    if (title.trim().length < 2) { toast.error('Название — минимум 2 символа'); return; }
    if (!openedAt) { toast.error('Дата открытия обязательна'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/vacancies/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          location: location.trim() || null,
          subdivision: subdivision.trim() || null,
          customer_name: customerName.trim() || null,
          priority: priority || null,
          manager_id: managerId || null,
          opened_at: openedAt,
          request_reason: requestReason.trim() || null,
          confidentiality,
          positions_count: positionsCount,
        }),
      });
      const json = await res.json() as { error?: { message: string } };
      if (!res.ok) { toast.error(json.error?.message ?? 'Ошибка создания заявки'); return; }
      toast.success('Заявка подана на согласование');
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error('Не удалось создать заявку');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая заявка на вакансию</DialogTitle>
          <DialogDescription>
            Заявка будет создана со статусом «На согласовании». После одобрения руководителем
            вакансия активируется.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Название */}
          <div className="grid gap-2">
            <Label htmlFor="req-title">Название вакансии *</Label>
            <Input
              id="req-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Продавец-консультант"
              maxLength={200}
              list="dl-titles"
            />
            <datalist id="dl-titles">
              {options.titles.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          {/* Город */}
          <div className="grid gap-2">
            <Label htmlFor="req-location">Город</Label>
            <Input
              id="req-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Сочи"
              maxLength={100}
              list="dl-locations"
            />
            <datalist id="dl-locations">
              {options.locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            {/* Штатная сверка — переиспользуем StaffingCheckWidget из фичи 1 */}
            <StaffingCheckWidget location={location} />
          </div>

          {/* Подразделение */}
          <div className="grid gap-2">
            <Label htmlFor="req-subdivision">Подразделение</Label>
            <Input
              id="req-subdivision"
              value={subdivision}
              onChange={(e) => setSubdivision(e.target.value)}
              placeholder="Розница"
              maxLength={100}
              list="dl-subdivisions"
            />
            <datalist id="dl-subdivisions">
              {options.subdivisions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          {/* ФИО заказчика */}
          <div className="grid gap-2">
            <Label htmlFor="req-customer">ФИО заказчика</Label>
            <Input
              id="req-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Иванов Иван Иванович"
              maxLength={200}
            />
          </div>

          {/* Кол-во ставок + приоритет */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="req-positions">Кол-во ставок</Label>
              <Input
                id="req-positions"
                type="number"
                min={1}
                max={100}
                value={positionsCount}
                onChange={(e) => setPositionsCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Приоритет</Label>
              <Select value={priority || 'none'} onValueChange={(v) => setPriority(v === 'none' ? '' : (v as 'высокий' | 'средний' | 'низкий'))}>
                <SelectTrigger>
                  <SelectValue placeholder="Не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не задан</SelectItem>
                  <SelectItem value="высокий">Высокий</SelectItem>
                  <SelectItem value="средний">Средний</SelectItem>
                  <SelectItem value="низкий">Низкий</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Исполнитель */}
          {(currentRole === 'head' || currentRole === 'admin') && (
            <div className="grid gap-2">
              <Label>Ответственный менеджер</Label>
              <Select value={managerId} onValueChange={setManagerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите менеджера" />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Дата открытия */}
          <div className="grid gap-2">
            <Label htmlFor="req-opened">Дата открытия *</Label>
            <Input
              id="req-opened"
              type="date"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
            />
          </div>

          {/* Конфиденциальность */}
          <div className="grid gap-2">
            <Label>Конфиденциальность</Label>
            <Select
              value={confidentiality}
              onValueChange={(v) => setConfidentiality(v as 'open' | 'confidential')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Открытая (публикуется на HH)</SelectItem>
                <SelectItem value="confidential">Конфиденциальная (без HH)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Причина */}
          <div className="grid gap-2">
            <Label htmlFor="req-reason">Причина открытия</Label>
            <Textarea
              id="req-reason"
              rows={3}
              maxLength={1000}
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
              placeholder="Расширение штата, открытие новой точки…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Подать заявку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
