'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Download, Loader2, Lock, Plus, Search,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
type AppearanceReason = 'dismissal' | 'replacement' | 'expansion' | 'internal_transfer' | 'other';

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
  customer_name: string | null;
  positions_count: number | null;
  appearance_reason: AppearanceReason | null;
  explanation: string | null;
  candidate_name: string | null;
  comment: string | null;
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
// Яркая палитра — для бейджа в колонке «Статус» (контраст на цветной строке).
const STATUS_VARIANTS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  probation: 'bg-amber-100 text-amber-900',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-800',
  draft: 'bg-blue-100 text-blue-800',
};
// Приглушённая палитра — фон всей строки по статусу (читаемость текста ячеек).
const STATUS_ROW_VARIANTS: Record<string, string> = {
  active: 'bg-green-50',
  probation: 'bg-amber-50',
  paused: 'bg-yellow-50',
  closed: 'bg-slate-50 text-slate-500',
  cancelled: 'bg-red-50',
  draft: 'bg-blue-50',
};
// Цвет приоритета. Ключи — реальные значения priority (рус., нижний регистр).
// Пустое/неизвестное → бейдж не рисуется (EC-1).
const PRIORITY_VARIANTS: Record<string, string> = {
  'высокий': 'bg-red-100 text-red-800',
  'средний': 'bg-yellow-100 text-yellow-800',
  'низкий': 'bg-green-100 text-green-800',
};
const APPEARANCE_REASON_LABELS: Record<string, string> = {
  dismissal: 'Увольнение',
  replacement: 'Замена',
  expansion: 'Расширение',
  internal_transfer: 'Внутр. перевод',
  other: 'Другое',
};
const APPEARANCE_REASONS: AppearanceReason[] = [
  'dismissal', 'replacement', 'expansion', 'internal_transfer', 'other',
];

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * TTF-правило (FEATURE_SPEC #3 §5.3):
 *   • закрытая (closed_at задан) → days_to_close (целое);
 *   • открытая → серое «N в работе» (today − opened_at, clamp ≥ 0).
 */
function ttfDisplay(v: AdminVacancy) {
  if (v.closed_at && v.days_to_close != null) {
    return <span className="tabular-nums">{v.days_to_close}</span>;
  }
  const openedMs = new Date(v.opened_at).getTime();
  const days = Math.max(0, Math.floor((Date.now() - openedMs) / 86_400_000));
  return <span className="text-muted-foreground tabular-nums">{days} в работе</span>;
}

/** Цветной бейдж приоритета; пустой/неизвестный → «—» (EC-1, не падает). */
function PriorityCell({ priority }: { priority: string | null }) {
  const key = (priority ?? '').trim().toLowerCase();
  const variant = PRIORITY_VARIANTS[key];
  if (!variant) return <span className="text-muted-foreground italic text-xs">—</span>;
  return <Badge className={cn('text-xs capitalize', variant)} variant="outline">{key}</Badge>;
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
            <p className="text-sm font-medium">Выберите дату закрытия</p>
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
// Текстовая или числовая ячейка с двойным кликом. numeric=true → парсит в число,
// валидирует (NaN/диапазон) с откатом и toast (EC-14).
function VacancyEditableCell({
  value,
  vacancyId,
  field,
  numeric = false,
  onUpdated,
}: {
  value: string | null;
  vacancyId: string;
  field: string;
  numeric?: boolean;
  onUpdated: (val: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  async function save() {
    const trimmed = draft.trim();
    const next = trimmed || null;
    if (next === (value ?? null)) { setEditing(false); return; }

    // Числовое поле (Кол-во): валидируем до отправки.
    let payload: string | number | null = next;
    if (numeric && next !== null) {
      const n = Number(next);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        toast.error('Введите целое число от 1 до 100');
        setDraft(value ?? '');
        setEditing(false);
        return;
      }
      payload = n;
    }

    try {
      const res = await fetch(`/api/vacancies/${vacancyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: payload }),
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
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void save(); }
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
        }}
        className="h-7 min-w-16 text-sm"
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

// ── AppearanceReasonCell — inline Select причины появления ───────────────────
function AppearanceReasonCell({
  vacancy,
  canEdit,
  onUpdated,
}: {
  vacancy: AdminVacancy;
  canEdit: boolean;
  onUpdated: (reason: AppearanceReason | null) => void;
}) {
  const NONE = '__none__';
  const [saving, setSaving] = useState(false);

  const label = vacancy.appearance_reason
    ? (APPEARANCE_REASON_LABELS[vacancy.appearance_reason] ?? vacancy.appearance_reason)
    : null;

  if (!canEdit) {
    return label
      ? <span className="text-xs">{label}</span>
      : <span className="text-muted-foreground italic text-xs">—</span>;
  }

  async function apply(next: AppearanceReason | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/vacancies/${vacancy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appearance_reason: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка'); return; }
      onUpdated(next);
    } catch { toast.error('Ошибка'); }
    finally { setSaving(false); }
  }

  return (
    <Select
      value={vacancy.appearance_reason ?? NONE}
      onValueChange={(v) => void apply(v === NONE ? null : (v as AppearanceReason))}
      disabled={saving}
    >
      <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {APPEARANCE_REASONS.map((r) => (
          <SelectItem key={r} value={r}>{APPEARANCE_REASON_LABELS[r]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── VacancyStaffingCell — ручная привязка вакансии к строке штатки (#2) ───────
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
  // Уникальные подразделения (Розница/Бэк офис/…) — для datalist создания и фильтра.
  const [subdivisions, setSubdivisions] = useState<string[]>([]);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('');
  const [subdivisionFilter, setSubdivisionFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page] = useState(1);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [crTitle, setCrTitle] = useState('');
  const [crLocation, setCrLocation] = useState('');
  const [crSubdivision, setCrSubdivision] = useState('');
  const [crCustomer, setCrCustomer] = useState('');
  const [crReason, setCrReason] = useState<AppearanceReason | '__none__'>('__none__');
  const [crExplanation, setCrExplanation] = useState('');
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
      if (subdivisionFilter !== 'all') qs.set('subdivision', subdivisionFilter);
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
  }, [statusFilter, typeFilter, cityFilter, subdivisionFilter, managerFilter, search, page]);

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

  // Справочник подразделений для datalist/фильтра (грузим один раз).
  useEffect(() => {
    fetch('/api/vacancies/requests/options')
      .then((r) => r.json())
      .then((j) => setSubdivisions(j.data?.subdivisions ?? []))
      .catch(() => { /* автодополнение необязательно */ });
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
          subdivision: crSubdivision.trim() || null,
          customer_name: crCustomer.trim() || null,
          appearance_reason: crReason === '__none__' ? null : crReason,
          explanation: crExplanation.trim() || null,
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
      setCrTitle(''); setCrLocation(''); setCrSubdivision(''); setCrCustomer('');
      setCrReason('__none__'); setCrExplanation(''); setCrManager(''); setCrHhId('');
      setCrOpenedAt(toISODate(new Date())); setCrStatus('active'); setCrType('open');
      void load();
    } catch { toast.error('Ошибка создания'); }
    finally { setCreating(false); }
  }

  // ── CSV Export ────────────────────────────────────────────────────────────
  function exportCsv() {
    const headers = [
      'Название', 'Город', 'Формат поиска', 'Причина появления', 'Пояснение',
      'Подразделение', 'ФИО Заказчика', 'Приоритет', 'Кол-во',
      'Дата открытия', 'Дата закрытия', 'Статус', 'Менеджер', 'TTF',
      'ФИО кандидата', 'Комментарий',
    ];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csvRows = rows.map((v) => [
      esc(v.title),
      v.location ?? '',
      v.confidentiality === 'confidential' ? 'Конфиденц.' : 'Открытый',
      v.appearance_reason ? (APPEARANCE_REASON_LABELS[v.appearance_reason] ?? v.appearance_reason) : '',
      esc(v.explanation ?? ''),
      v.subdivision ?? '',
      esc(v.customer_name ?? ''),
      v.priority ?? '',
      v.positions_count ?? '',
      fmtDate(v.opened_at),
      fmtDate(v.closed_at),
      STATUS_LABELS[v.status] ?? v.status,
      isExecutive ? '' : (v.manager?.full_name ?? ''),
      v.days_to_close ?? '',
      esc(v.candidate_name ?? ''),
      esc(v.comment ?? ''),
    ].join(';'));
    const csv = [headers.join(';'), ...csvRows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vacancies_data_${toISODate(new Date())}.csv`;
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
            {total} вакансий · смена статуса и правка ячеек прямо в таблице
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

        <Select value={subdivisionFilter} onValueChange={setSubdivisionFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Подразделение" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все подразделения</SelectItem>
            {subdivisions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
          className="w-32"
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
          <Table className="text-xs min-w-425 [&_td]:py-1 [&_th]:py-1.5">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Название</TableHead>
                <TableHead>Город</TableHead>
                <TableHead>Формат поиска</TableHead>
                <TableHead>Причина появления</TableHead>
                <TableHead className="min-w-40">Пояснение</TableHead>
                <TableHead>Подразделение</TableHead>
                <TableHead>ФИО Заказчика</TableHead>
                <TableHead>Приоритет</TableHead>
                <TableHead className="text-right">Кол-во</TableHead>
                <TableHead>Дата открытия</TableHead>
                <TableHead>Дата закрытия</TableHead>
                <TableHead>Статус</TableHead>
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
                <TableHead className="text-right">TTF</TableHead>
                <TableHead>ФИО кандидата</TableHead>
                <TableHead className="min-w-40">Комментарий</TableHead>
                {/* Операционные (нет в Data, но нужны): привязка к штатке (#2), HH ID, Ref */}
                <TableHead>Штатка</TableHead>
                <TableHead>HH ID</TableHead>
                <TableHead>Ref</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id} className={cn(STATUS_ROW_VARIANTS[v.status])}>
                  {/* 1. Название */}
                  <TableCell className="font-medium">
                    {canEdit
                      ? <VacancyEditableCell value={v.title} vacancyId={v.id} field="title" onUpdated={(val) => updateRow(v.id, { title: val ?? v.title })} />
                      : v.title}
                  </TableCell>
                  {/* 2. Город */}
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.location} vacancyId={v.id} field="location" onUpdated={(val) => updateRow(v.id, { location: val })} />
                      : (v.location ?? '—')}
                  </TableCell>
                  {/* 3. Формат поиска */}
                  <TableCell>
                    {v.confidentiality === 'confidential' ? (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Lock className="size-3" /> Конфиденц.
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Открытый</Badge>
                    )}
                  </TableCell>
                  {/* 4. Причина появления */}
                  <TableCell>
                    <AppearanceReasonCell
                      vacancy={v}
                      canEdit={canEdit}
                      onUpdated={(r) => updateRow(v.id, { appearance_reason: r })}
                    />
                  </TableCell>
                  {/* 5. Пояснение */}
                  <TableCell className="text-muted-foreground">
                    {canEdit
                      ? <VacancyEditableCell value={v.explanation} vacancyId={v.id} field="explanation" onUpdated={(val) => updateRow(v.id, { explanation: val })} />
                      : (v.explanation ?? '—')}
                  </TableCell>
                  {/* 6. Подразделение */}
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.subdivision} vacancyId={v.id} field="subdivision" onUpdated={(val) => updateRow(v.id, { subdivision: val })} />
                      : (v.subdivision ?? '—')}
                  </TableCell>
                  {/* 7. ФИО Заказчика */}
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.customer_name} vacancyId={v.id} field="customer_name" onUpdated={(val) => updateRow(v.id, { customer_name: val })} />
                      : (v.customer_name ?? '—')}
                  </TableCell>
                  {/* 8. Приоритет */}
                  <TableCell><PriorityCell priority={v.priority} /></TableCell>
                  {/* 9. Кол-во */}
                  <TableCell className="text-right tabular-nums">
                    {canEdit
                      ? <VacancyEditableCell value={v.positions_count != null ? String(v.positions_count) : null} vacancyId={v.id} field="positions_count" numeric onUpdated={(val) => updateRow(v.id, { positions_count: val ? Number(val) : null })} />
                      : (v.positions_count ?? '—')}
                  </TableCell>
                  {/* 10. Дата открытия */}
                  <TableCell>{fmtDate(v.opened_at)}</TableCell>
                  {/* 11. Дата закрытия */}
                  <TableCell>{fmtDate(v.closed_at)}</TableCell>
                  {/* 12. Статус */}
                  <TableCell>
                    <VacancyStatusCell
                      vacancy={v}
                      canEdit={canEdit}
                      onUpdated={(patch) => updateRow(v.id, patch)}
                    />
                  </TableCell>
                  {/* 13. Менеджер */}
                  <TableCell>
                    {isExecutive
                      ? <span className="text-muted-foreground italic text-xs">—</span>
                      : (v.manager?.full_name ?? '—')}
                  </TableCell>
                  {/* 14. TTF */}
                  <TableCell className="text-right">{ttfDisplay(v)}</TableCell>
                  {/* 15. ФИО кандидата */}
                  <TableCell>
                    {canEdit
                      ? <VacancyEditableCell value={v.candidate_name} vacancyId={v.id} field="candidate_name" onUpdated={(val) => updateRow(v.id, { candidate_name: val })} />
                      : (v.candidate_name ?? '—')}
                  </TableCell>
                  {/* 16. Комментарий */}
                  <TableCell className="text-muted-foreground">
                    {canEdit
                      ? <VacancyEditableCell value={v.comment} vacancyId={v.id} field="comment" onUpdated={(val) => updateRow(v.id, { comment: val })} />
                      : (v.comment ?? '—')}
                  </TableCell>
                  {/* + Штатка (#2) */}
                  <TableCell>
                    <VacancyStaffingCell
                      vacancy={v}
                      options={staffingOptions}
                      canEdit={canEdit}
                      onUpdated={(spid) => updateRow(v.id, { staffing_plan_id: spid })}
                    />
                  </TableCell>
                  {/* + HH ID */}
                  <TableCell className="font-mono text-xs">{v.hh_vacancy_id ?? '—'}</TableCell>
                  {/* + Ref */}
                  <TableCell className="font-mono text-xs">{v.internal_ref ?? '—'}</TableCell>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cr-subdivision">Подразделение</Label>
                <Input
                  id="cr-subdivision"
                  value={crSubdivision}
                  onChange={(e) => setCrSubdivision(e.target.value)}
                  placeholder="Розница"
                  maxLength={100}
                  list="dl-cr-subdivisions"
                />
                <datalist id="dl-cr-subdivisions">
                  {subdivisions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cr-customer">ФИО Заказчика</Label>
                <Input id="cr-customer" value={crCustomer} onChange={(e) => setCrCustomer(e.target.value)} placeholder="Иванов И.И." maxLength={200} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Причина появления</Label>
              <Select value={crReason} onValueChange={(v) => setCrReason(v as AppearanceReason | '__none__')}>
                <SelectTrigger><SelectValue placeholder="Не указана" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Не указана</SelectItem>
                  {APPEARANCE_REASONS.map((r) => <SelectItem key={r} value={r}>{APPEARANCE_REASON_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-explanation">Пояснение</Label>
              <Textarea id="cr-explanation" rows={2} maxLength={2000} value={crExplanation} onChange={(e) => setCrExplanation(e.target.value)} placeholder="Декрет основного сотрудника" />
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
