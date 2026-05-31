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
  // Режим должности: 'staffing' — выбор из штатного расписания (даёт привязку
  // staffing_plan_id, учитывается в укомплектованности); 'free' — нет в штатке,
  // свободный ввод названия/города, без привязки (FEATURE_SPEC_auto_staffing).
  const [mode, setMode] = useState<'staffing' | 'free'>('staffing');
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
  // Штатка: города со штаткой и позиции выбранного города.
  const [staffingCities, setStaffingCities] = useState<string[]>([]);
  const [staffingCity, setStaffingCity] = useState('');
  const [staffingPositions, setStaffingPositions] = useState<{ id: string; position_name: string }[]>([]);
  const [staffingPlanId, setStaffingPlanId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('staffing');
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
    setStaffingCity('');
    setStaffingPositions([]);
    setStaffingPlanId('');
  }, [open, currentUserId, currentRole]);

  // Автодополнение: уникальные значения из существующих вакансий (datalist, режим «нет в штатке»).
  useEffect(() => {
    if (!open) return;
    fetch('/api/vacancies/requests/options')
      .then((r) => r.json())
      .then((j) => setOptions(j.data ?? { titles: [], locations: [], subdivisions: [] }))
      .catch(() => { /* автодополнение необязательно */ });
  }, [open]);

  // Города со штаткой — для первого селекта режима «из штатки».
  useEffect(() => {
    if (!open) return;
    fetch('/api/staffing/positions')
      .then((r) => r.json())
      .then((j) => setStaffingCities(j.data?.cities ?? []))
      .catch(() => { /* штатка необязательна; останется пустой список */ });
  }, [open]);

  // Смена города (режим штатки) → сброс выбранной позиции + загрузка её должностей (EC-15).
  useEffect(() => {
    if (!open || mode !== 'staffing') return;
    setStaffingPlanId('');
    setStaffingPositions([]);
    const city = staffingCity.trim();
    if (!city) return;
    const controller = new AbortController();
    fetch(`/api/staffing/positions?city=${encodeURIComponent(city)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((j) => setStaffingPositions(j.data?.positions ?? []))
      .catch(() => { /* при ошибке список пуст */ });
    return () => controller.abort();
  }, [open, mode, staffingCity]);

  async function handleSubmit() {
    // Источник истины названия/города зависит от режима.
    let payloadTitle: string;
    let payloadLocation: string | null;
    let payloadPlanId: string | null;

    if (mode === 'staffing') {
      if (!staffingPlanId) { toast.error('Выберите должность из штатного расписания'); return; }
      const pos = staffingPositions.find((p) => p.id === staffingPlanId);
      // title/location сервер всё равно перепишет из строки штатки — шлём для полноты.
      payloadTitle = pos?.position_name ?? '';
      payloadLocation = staffingCity.trim() || null;
      payloadPlanId = staffingPlanId;
    } else {
      if (title.trim().length < 2) { toast.error('Название — минимум 2 символа'); return; }
      payloadTitle = title.trim();
      payloadLocation = location.trim() || null;
      payloadPlanId = null;
    }
    if (!openedAt) { toast.error('Дата открытия обязательна'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/vacancies/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: payloadTitle,
          location: payloadLocation,
          staffing_plan_id: payloadPlanId,
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
          {/* Источник должности: из штатки (привязка) или свободный ввод */}
          <div className="grid gap-2">
            <Label>Должность *</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'staffing' | 'free')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staffing">Из штатного расписания</SelectItem>
                <SelectItem value="free">Нет в штатке (свободный ввод)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'staffing' ? (
            <>
              {/* Город из штатки */}
              <div className="grid gap-2">
                <Label>Город *</Label>
                <Select value={staffingCity} onValueChange={setStaffingCity}>
                  <SelectTrigger>
                    <SelectValue placeholder={staffingCities.length ? 'Выберите город' : 'Штатка не задана'} />
                  </SelectTrigger>
                  <SelectContent>
                    {staffingCities.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Должность из штатки выбранного города */}
              <div className="grid gap-2">
                <Label>Должность из штатки *</Label>
                <Select
                  value={staffingPlanId}
                  onValueChange={setStaffingPlanId}
                  disabled={!staffingCity || staffingPositions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !staffingCity
                          ? 'Сначала выберите город'
                          : staffingPositions.length === 0
                            ? 'В этом городе нет должностей'
                            : 'Выберите должность'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {staffingPositions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.position_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Название и город подставятся из штатки; вакансия учитывается в укомплектованности.
                </p>
              </div>

              {/* Штатная сверка по выбранному городу */}
              {staffingCity && <StaffingCheckWidget location={staffingCity} />}
            </>
          ) : (
            <>
              {/* Свободное название */}
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
                <p className="text-muted-foreground text-xs">
                  Без привязки к штатке — в укомплектованности не учитывается.
                </p>
              </div>

              {/* Свободный город */}
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
                <StaffingCheckWidget location={location} />
              </div>
            </>
          )}

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
