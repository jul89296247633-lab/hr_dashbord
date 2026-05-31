'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Download, Loader2, Plus, Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type VacancyStatus = 'active' | 'probation' | 'paused' | 'closed' | 'cancelled' | 'draft';
type VacancyType = 'open' | 'confidential';

interface AdminVacancy {
  id: string;
  hh_vacancy_id: string | null;
  internal_ref: string | null;
  title: string;
  subdivision: string | null;
  location: string | null;
  manager_id: string | null;
  status: VacancyStatus;
  confidentiality: VacancyType;
  opened_at: string;
  closed_at: string | null;
  days_to_close: number | null;
  priority: string | null;
  staffing_plan_id: string | null;
  manager: { id: string; full_name: string } | null;
}

interface StaffingOption {
  id: string;
  city: string;
  position_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Активна',
  probation: 'Стажировка',
  paused: 'Пауза',
  closed: 'Закрыта',
  cancelled: 'Отмена',
  draft: 'Черновик',
};
const STATUS_VARIANTS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  probation: 'bg-amber-100 text-amber-900',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-800',
  draft: 'bg-blue-100 text-blue-800',
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ── VacancyStatusCell ────────────────────────────────────────────────────────
function VacancyStatusCell({
  vacancy,
  canEdit,
  onUpdated,
}: {
  vacancy: AdminVacancy;
  canEdit: boolean;
  onUpdated: (v: Partial<AdminVacancy>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<VacancyStatus | null>(null);
  const [closedAt, setClosedAt] = useState<Date>(new Date());
  const [saving, setSaving] = useState(false);

  if (!canEdit) {
    return (
      <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', STATUS_VARIANTS[vacancy.status])}>
        {STATUS_LABELS[vacancy.status] ?? vacancy.status}
      </span>
    );
  }

  async function applyStatus(status: VacancyStatus, closed?: string) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { status };
      if (status === 'closed') body.closed_at = closed ?? toISODate(new Date());
      const res = await fetch(`/api/vacancies/${vacancy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка'); return; }
      toast.success(status === 'closed' ? 'Закрыто, бонус начислен' : 'Статус обновлён');
      onUpdated({ status, closed_at: status === 'closed' ? (closed ?? toISODate(new Date())) : null });
      setOpen(false);
      setPendingStatus(null);
    } catch { toast.error('Ошибка'); }
    finally { setSaving(false); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80',
            STATUS_VARIANTS[vacancy.status],
          )}
        >
          {STATUS_LABELS[vacancy.status] ?? vacancy.status}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {pendingStatus === 'closed' ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Дата закрытия</p>
            <Calendar
              mode="single"
              selected={closedAt}
              onSelect={(d) => d && setClosedAt(d)}
              disabled={(d) => d > new Date()}
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => void applyStatus('closed', toISODate(closedAt))} disabled={saving}>
                {saving ? <Loader2 className="size-3 animate-spin" /> : 'Закрыть'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPendingStatus(null)}>Отмена</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-1">
            {(['active', 'probation', 'paused', 'closed', 'cancelled', 'draft'] as VacancyStatus[])
              .filter((s) => s !== vacancy.status)
              .map((s) => (
                <button
                  key={s}
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    if (s === 'closed') { setPendingStatus('closed'); }
                    else { void applyStatus(s); setOpen(false); }
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── VacancyEditableCell ──────────────────────────────────────────────────────
function VacancyEditableCell({
  value,
  vacancyId,
  field,
  onUpdated,
}: {
  value: string | null;
  vacancyId: string;
  field: string;
  onUpdated: (val: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  async function save() {
    const next = draft.trim() || null;
    if (next === (value ?? null)) { setEditing(false); return; }
    try {
      const res = await fetch(`/api/vacancies/${vacancyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) { toast.error('Ошибка сохранения'); setDraft(value ?? ''); return; }
      onUpdated(next);
    } catch { toast.error('Ошибка сохранения'); setDraft(value ?? ''); }
    finally { setEditing(false); }
  }

  if (editing) {
    return (
      <Input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void save(); }
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        }}
        className="h-7 min-w-24 text-sm"
      />
    );
  }

  return (
    <span
      className="cursor-pointer rounded px-1 hover:bg-muted"
      onDoubleClick={() => { setDraft(value ?? ''); setEditing(true); }}
      title="Двойной клик для редактирования"
    >
      {value ?? <span className="text-muted-foreground italic text-xs">—</span>}
    </span>
  );
}

// ── VacancyStaffingCell — ручная привязка вакансии к строке штатки ───────────
function VacancyStaffingCell({
  vacancy,
  options,
  canEdit,
  onUpdated,
}: {
  vacancy: AdminVacancy;
  options: StaffingOption[];
  canEdit: boolean;
  onUpdated: (staffingPlanId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const current = options.find((o) => o.id === vacancy.staffing_plan_id) ?? null;
  const label = current ? `${current.city} — ${current.position_name}` : null;

  const filtered = filter.trim()
    ? options.filter((o) =>
        `${o.city} ${o.position_name}`.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : options;

  async function bind(staffingPlanId: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/vacancies/${vacancy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffing_plan_id: staffingPlanId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка привязки'); return; }
      toast.success(staffingPlanId ? 'Привязано к штатке' : 'Отвязано от штатки');
      onUpdated(staffingPlanId);
      setOpen(false);
    } catch { toast.error('Ошибка привязки'); }
    finally { setSaving(false); }
  }

  if (!canEdit) {
    return label
      ? <span className="text-xs">{label}</span>
      : <span className="text-muted-foreground italic text-xs">—</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'cursor-pointer rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-muted',
            label ? 'font-medium' : 'text-muted-foreground italic',
          )}
          title="Привязать к штатному расписанию"
        >
          {label ?? 'Не привязана'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="grid gap-2">
          <Input
            placeholder="Поиск: город / должность"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 text-sm"
          />
          {vacancy.staffing_plan_id && (
            <Button
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => void bind(null)}
              disabled={saving}
            >
              Отвязать
            </Button>
          )}
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground px-1 py-2 text-xs">Ничего не найдено</p>
            ) : (
              filtered.slice(0, 100).map((o) => (
                <button
                  key={o.id}
                  className={cn(
                    'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                    o.id === vacancy.staffing_plan_id && 'bg-muted font-medium',
                  )}
                  onClick={() => void bind(o.id)}
                  disabled={saving}
                >
                  {o.city} — {o.position_name}
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function AdminVacanciesClient({
  role,
  managers,
}: {
  role: Role;
  managers: { id: string; full_name: string }[];
}) {
  const canEdit = role === 'head' || role === 'admin';
  const isExecutive = role === 'executive';

  const [rows, setRows] = useState<AdminVacancy[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffingOptions, setStaffingOptions] = useState<StaffingOption[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('');
  const [managerFilter, setManagerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page] = useState(1);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [crTitle, setCrTitle] = useState('');
  const [crLocation, setCrLocation] = useState('');
  const [crManager, setCrManager] = useState('');
  const [crType, setCrType] = useState<'open' | 'confidential'>('open');
  const [crHhId, setCrHhId] = useState('');
  const [crOpenedAt, setCrOpenedAt] = useState(toISODate(new Date()));
  const [crStatus, setCrStatus] = useState<VacancyStatus>('active');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: '50' });
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (typeFilter !== 'all') qs.set('type', typeFilter);
      if (cityFilter.trim()) qs.set('city', cityFilter.trim());
      if (managerFilter !== 'all') qs.set('manager_id', managerFilter);
      if (search.trim()) qs.set('search', search.trim());

      const res = await fetch(`/api/vacancies/admin?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, cityFilter, managerFilter, search, page]);

  useEffect(() => { void load(); }, [load]);

  // Справочник строк штатки для ручной привязки (грузим один раз).
  useEffect(() => {
    fetch('/api/staffing/plan')
      .then((r) => r.json())
      .then((j) => {
        const list = (j.data ?? []) as { id: string; city: string; position_name: string }[];
        setStaffingOptions(
          list.map((s) => ({ id: s.id, city: s.city, position_name: s.position_name })),
        );
      })
      .catch(() => { /* привязка необязательна; список останется пустым */ });
  }, []);

  function updateRow(id: string, patch: Partial<AdminVacancy>) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  }

  // ── Create ────────────────────────────────────────────────────────────────
  async function handleCreate() {
    if (crTitle.trim().length < 2) { toast.error('Название — минимум 2 символа'); return; }
    if (!crManager && !isExecutive) { toast.error('Выберите менеджера'); return; }

    setCreating(true);
    try {
      const res = await fetch('/api/vacancies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: crTitle.trim(),
          location: crLocation.trim() || null,
          manager_id: crManager || managers[0]?.id,
          hh_vacancy_id: crHhId.trim() || null,
          opened_at: crOpenedAt,
          status: crStatus,
          confidentiality: crType,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка создания'); return; }
      toast.success('Вакансия создана');
      setCreateOpen(false);
      setCrTitle(''); setCrLocation(''); setCrManager(''); setCrHhId('');
      setCrOpenedAt(toISODate(new Date())); setCrStatus('active'); setCrType('open');
      void load();
    } catch { toast.error('Ошибка создания'); }
    finally { setCreating(false); }
  }

  // ── CSV Export ────────────────────────────────────────────────────────────
  function exportCsv() {
    const headers = ['ID (коротко)', 'Название', 'Подразделение', 'Город', 'Менеджер', 'Статус', 'Тип', 'HH ID', 'Ref', 'Открыта', 'Закрыта', 'Дней'];
    const csvRows = rows.map((v) => [
      v.id.slice(0, 8),
      `"${v.title.replace(/"/g, '""')}"`,
      v.subdivision ?? '',
      v.location ?? '',
      isExecutive ? '' : (v.manager?.full_name ?? ''),
      STATUS_LABELS[v.status] ?? v.status,
      v.confidentiality === 'confidential' ? 'Конф.' : 'Откр.',
      v.hh_vacancy_id ?? '',
      v.internal_ref ?? '',
      fmtDate(v.opened_at),
      fmtDate(v.closed_at),
      v.days_to_close ?? '',
    ].join(';'));
    const csv = [headers.join(';'), ...csvRows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vacancies_admin_${toISODate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="grid gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Все вакансии</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {total} вакансий · inline edit двойным кликом
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" />
            CSV
          </Button>
          {canEdit && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Добавить
            </Button>
          )}
        </div>
      </div>

      {/* Sticky filters */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="closed">Закрытые</SelectItem>
            <SelectItem value="paused">На паузе</SelectItem>
            <SelectItem value="draft">Черновики</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="open">Открытые</SelectItem>
            <SelectItem value="confidential">Конфиденциальные</SelectItem>
          </SelectContent>
        </Select>

        {!isExecutive && (
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Менеджер" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все менеджеры</SelectItem>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <div className="relative flex-1 min-w-40">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Поиск по названию"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Input
          className="w-36"
          placeholder="Город"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Вакансий нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">ID</TableHead>
                <TableHead className="min-w-48">Название</TableHead>
                <TableHead>Подразделение</TableHead>
                <TableHead>Город</TableHead>
                <TableHead>Штатка</TableHead>
                {!isExecutive
                  ? <TableHead>Менеджер</TableHead>
                  : (
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help text-muted-foreground">Менеджер</span>
                        </TooltipTrigger>
                        <TooltipContent>Скрыто для роли руководителя</TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                <TableHead>Статус</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>HH ID</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Открыта</TableHead>
                <TableHead>Закрыта</TableHead>
                <TableHead className="text-right">Дней</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{v.id.slice(0, 8)}</TableCell>
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.title} vacancyId={v.id} field="title" onUpdated={(val) => updateRow(v.id, { title: val ?? v.title })} />
                      : v.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {canEdit
                      ? <VacancyEditableCell value={v.subdivision} vacancyId={v.id} field="subdivision" onUpdated={(val) => updateRow(v.id, { subdivision: val })} />
                      : (v.subdivision ?? '—')}
                  </TableCell>
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.location} vacancyId={v.id} field="location" onUpdated={(val) => updateRow(v.id, { location: val })} />
                      : (v.location ?? '—')}
                  </TableCell>
                  <TableCell>
                    <VacancyStaffingCell
                      vacancy={v}
                      options={staffingOptions}
                      canEdit={canEdit}
                      onUpdated={(spid) => updateRow(v.id, { staffing_plan_id: spid })}
                    />
                  </TableCell>
                  <TableCell>
                    {isExecutive
                      ? <span className="text-muted-foreground italic text-xs">—</span>
                      : (v.manager?.full_name ?? '—')}
                  </TableCell>
                  <TableCell>
                    <VacancyStatusCell
                      vacancy={v}
                      canEdit={canEdit}
                      onUpdated={(patch) => updateRow(v.id, patch)}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {v.confidentiality === 'confidential' ? 'Конф.' : 'Откр.'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.hh_vacancy_id ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{v.internal_ref ?? '—'}</TableCell>
                  <TableCell className="text-sm">{fmtDate(v.opened_at)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(v.closed_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.days_to_close ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Добавить вакансию</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cr-title">Название *</Label>
              <Input id="cr-title" value={crTitle} onChange={(e) => setCrTitle(e.target.value)} placeholder="Менеджер по продажам" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cr-loc">Город</Label>
                <Input id="cr-loc" value={crLocation} onChange={(e) => setCrLocation(e.target.value)} placeholder="Сочи" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cr-opened">Дата открытия</Label>
                <Input id="cr-opened" type="date" value={crOpenedAt} onChange={(e) => setCrOpenedAt(e.target.value)} />
              </div>
            </div>
            {!isExecutive && (
              <div className="grid gap-1.5">
                <Label>Менеджер *</Label>
                <Select value={crManager} onValueChange={setCrManager}>
                  <SelectTrigger><SelectValue placeholder="Выберите менеджера" /></SelectTrigger>
                  <SelectContent>
                    {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Тип</Label>
                <Select value={crType} onValueChange={(v) => setCrType(v as 'open' | 'confidential')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Открытая</SelectItem>
                    <SelectItem value="confidential">Конфиденциальная</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Статус</Label>
                <Select value={crStatus} onValueChange={(v) => setCrStatus(v as VacancyStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активна</SelectItem>
                    <SelectItem value="draft">Черновик</SelectItem>
                    <SelectItem value="paused">На паузе</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {crType === 'open' && (
              <div className="grid gap-1.5">
                <Label htmlFor="cr-hh">HH ID (опционально)</Label>
                <Input id="cr-hh" value={crHhId} onChange={(e) => setCrHhId(e.target.value)} placeholder="98765432" />
              </div>
            )}
            {crType === 'confidential' && (
              <p className="text-muted-foreground text-xs">Внутренний реф (CONF-2026-NNNN) будет сгенерирован автоматически.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
