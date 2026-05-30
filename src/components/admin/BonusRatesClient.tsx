'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { History, Loader2, Pencil, Plus, Trash2, Upload, X, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface RateRow {
  id: string;
  position_name: string;
  amount_kopecks: number;
  amount_display: string;
  group_name: string | null;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  user: { id: string; full_name: string; role: string } | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** /admin/bonuses — таблица тарифов бонусов с inline edit, историей, созданием. */
export function BonusRatesClient() {
  const router = useRouter();
  const [rows, setRows] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createGroup, setCreateGroup] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline edit state: id → {name, amount}
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  // History modal
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [historyName, setHistoryName] = useState('');
  const [historyRows, setHistoryRows] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/bonus-rates');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Create ──────────────────────────────────────────────────────────────────
  async function handleCreate() {
    const name = createName.trim();
    const amount = parseFloat(createAmount.replace(',', '.'));
    if (name.length < 2) { toast.error('Название — минимум 2 символа'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Укажите корректную сумму'); return; }

    setCreating(true);
    try {
      const res = await fetch('/api/admin/bonus-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_name: name, amount_rubles: amount, group_name: createGroup.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка создания'); return; }
      toast.success('Тариф добавлен');
      setCreateOpen(false);
      setCreateName(''); setCreateAmount(''); setCreateGroup('');
      void load();
    } catch { toast.error('Ошибка создания'); }
    finally { setCreating(false); }
  }

  // ── Inline Edit ─────────────────────────────────────────────────────────────
  function startEdit(r: RateRow) {
    setEditId(r.id);
    setEditName(r.position_name);
    setEditAmount(String(r.amount_kopecks / 100));
  }

  function cancelEdit() { setEditId(null); }

  async function saveEdit(id: string) {
    const name = editName.trim();
    const amount = parseFloat(editAmount.replace(',', '.'));
    if (name.length < 2) { toast.error('Название — минимум 2 символа'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Укажите корректную сумму'); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/bonus-rates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_name: name, amount_rubles: amount }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка сохранения'); return; }
      toast.success('Тариф обновлён');
      setEditId(null);
      void load();
    } catch { toast.error('Ошибка сохранения'); }
    finally { setSaving(false); }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(r: RateRow) {
    if (!confirm(`Удалить тариф «${r.position_name}»? Существующие бонусы не изменятся.`)) return;
    try {
      const res = await fetch(`/api/admin/bonus-rates/${r.id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json(); toast.error(j?.error?.message ?? 'Ошибка'); return; }
      toast.success('Тариф удалён');
      void load();
    } catch { toast.error('Ошибка удаления'); }
  }

  // ── History ─────────────────────────────────────────────────────────────────
  async function openHistory(r: RateRow) {
    setHistoryId(r.id);
    setHistoryName(r.position_name);
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/bonus-rates/${r.id}/history`);
      const json = await res.json();
      setHistoryRows(json.data ?? []);
    } catch { /* тихо */ }
    finally { setHistoryLoading(false); }
  }

  // Группировка тарифов по group_name
  const groups = (() => {
    const map = new Map<string, RateRow[]>();
    for (const r of rows) {
      const key = r.group_name ?? '—';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru'));
  })();

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Тарифы бонусов</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Справочник тарифов «Должность → Сумма закрытия». Изменение не пересчитывает ранее начисленные бонусы.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/onboarding')}>
            <Upload className="size-4" />
            Импорт XLSX
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Добавить тариф
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Тарифов нет. Добавьте первый или импортируйте XLSX.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Должность</TableHead>
                <TableHead className="text-right">Сумма (₽)</TableHead>
                <TableHead>Изменён</TableHead>
                <TableHead className="w-28 text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(([groupName, groupRows]) => (
                <Fragment key={groupName}>
                  {/* Заголовок группы */}
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupName}
                    </TableCell>
                  </TableRow>
                  {groupRows.map((r) =>
                    editId === r.id ? (
                      // Inline edit row
                      <TableRow key={r.id} className="bg-muted/20">
                        <TableCell>
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 w-full"
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(r.id); if (e.key === 'Escape') cancelEdit(); }}
                            autoFocus
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="h-8 w-28 text-right"
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(r.id); if (e.key === 'Escape') cancelEdit(); }}
                          />
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => void saveEdit(r.id)} disabled={saving} aria-label="Сохранить">
                            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-green-600" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={cancelEdit} aria-label="Отмена">
                            <X className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.position_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.amount_display}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{fmtDate(r.updated_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(r)} aria-label="Редактировать">
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => void openHistory(r)} aria-label="История">
                            <History className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => void handleDelete(r)} aria-label="Удалить">
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить тариф</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cr-name">Должность</Label>
              <Input id="cr-name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Продавец-консультант" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cr-amount">Сумма (₽)</Label>
              <Input id="cr-amount" type="number" min={0} value={createAmount} onChange={(e) => setCreateAmount(e.target.value)} placeholder="50000" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cr-group">Группа (необязательно)</Label>
              <Input id="cr-group" value={createGroup} onChange={(e) => setCreateGroup(e.target.value)} placeholder="Розница" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History modal */}
      <Dialog open={!!historyId} onOpenChange={(o) => { if (!o) setHistoryId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>История: {historyName}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : historyRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Изменений не найдено.</p>
          ) : (
            <div className="grid gap-3 max-h-80 overflow-y-auto">
              {historyRows.map((e) => (
                <div key={e.id} className="border-l-2 pl-3 text-sm">
                  <div className="text-muted-foreground text-xs">
                    {fmtDate(e.created_at)} · {e.user?.full_name ?? 'Система'} · {e.action}
                  </div>
                  {e.new_values && (
                    <div className="mt-0.5 font-mono text-xs">
                      {Object.entries(e.new_values).map(([k, v]) => (
                        <span key={k} className="mr-3">
                          <span className="text-muted-foreground">{k}:</span>{' '}
                          {String(v)}
                          {e.old_values?.[k] !== undefined && (
                            <span className="text-muted-foreground"> (было {String(e.old_values[k])})</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
