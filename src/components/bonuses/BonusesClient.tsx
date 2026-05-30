'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ManagerName } from '@/components/shared/ManagerName';
import type { TeamResponse } from '@/components/dashboard/types';

interface BonusRow {
  id: string;
  vacancy_id: string;
  manager_id: string;
  matched_position_name: string | null;
  bonus_amount_kopecks: number | null;
  bonus_amount_display: string | null;
  bonus_date: string;
  status: string;
  source: string;
  vacancy: { id: string; title: string; closed_at: string | null } | null;
  manager: { id: string; full_name: string; is_active: boolean } | null;
}
interface BonusesResponse {
  data: BonusRow[];
  total_amount_kopecks: number;
  total_amount_display: string;
  meta: { total: number };
}
interface RateOption {
  id: string;
  position_name: string;
  amount_kopecks: number;
  amount_display: string;
}

function formatKopecks(k: number) {
  return `${(k / 100).toLocaleString('ru-RU')} ₽`;
}

export function BonusesClient({ role }: { role: Role }) {
  const canManage = role === 'head' || role === 'admin';
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState<'pending' | 'unmatched' | 'paid'>('pending');
  const [managerFilter, setManagerFilter] = useState('all');
  const [rows, setRows] = useState<BonusRow[]>([]);
  const [totalDisplay, setTotalDisplay] = useState('0 ₽');
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Match modal
  const [matchBonus, setMatchBonus] = useState<BonusRow | null>(null);
  const [rates, setRates] = useState<RateOption[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [selectedRate, setSelectedRate] = useState<RateOption | null>(null);
  const [matching, setMatching] = useState(false);

  // Mark-paid state
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    fetch('/api/dashboard/team?period=month')
      .then((r) => r.json())
      .then((j) => {
        const t = j.data as TeamResponse | undefined;
        setManagers(
          (t?.managers ?? [])
            .filter((m) => m.id && m.full_name)
            .map((m) => ({ id: m.id as string, full_name: m.full_name as string })),
        );
      })
      .catch(() => setManagers([]));
  }, [canManage]);

  // Map tab → API status param
  const tabToStatus: Record<string, string> = {
    pending: 'pending',
    unmatched: 'unmatched',
    paid: 'paid',
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ status: tabToStatus[tab] ?? 'pending' });
      if (managerFilter !== 'all') qs.set('manager_id', managerFilter);
      const res = await fetch(`/api/bonuses?${qs}`);
      const json = (await res.json()) as BonusesResponse & { error?: { message?: string } };
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
      setTotalDisplay(json.total_amount_display ?? '0 ₽');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [tab, managerFilter]);

  useEffect(() => { void load(); }, [load]);

  // ── Match ──────────────────────────────────────────────────────────────────
  async function openMatchModal(bonus: BonusRow) {
    setMatchBonus(bonus);
    setSelectedRate(null);
    setRates([]);
    setRatesLoading(true);
    try {
      const res = await fetch('/api/admin/bonus-rates');
      const json = await res.json();
      setRates(json.data ?? []);
    } catch { /* тихо */ }
    finally { setRatesLoading(false); }
  }

  async function handleMatch() {
    if (!matchBonus || !selectedRate) return;
    setMatching(true);
    try {
      const res = await fetch(`/api/bonuses/${matchBonus.id}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matched_position_name: selectedRate.position_name,
          bonus_amount_kopecks: selectedRate.amount_kopecks,
        }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка'); return; }
      toast.success('Тариф привязан');
      setMatchBonus(null);
      void load();
    } catch { toast.error('Ошибка'); }
    finally { setMatching(false); }
  }

  // ── Mark Paid ──────────────────────────────────────────────────────────────
  async function handleMarkPaid(bonusId: string) {
    setPayingId(bonusId);
    try {
      const res = await fetch(`/api/bonuses/${bonusId}/mark-paid`, { method: 'PATCH' });
      const json = await res.json();
      if (!res.ok) { toast.error(json?.error?.message ?? 'Ошибка'); return; }
      toast.success('Помечено как выплачено');
      void load();
    } catch { toast.error('Ошибка'); }
    finally { setPayingId(null); }
  }

  // Группировка по менеджеру
  const groups = (() => {
    const map = new Map<string, { manager: BonusRow['manager']; rows: BonusRow[]; subtotal: number }>();
    for (const r of rows) {
      const key = r.manager?.id ?? 'no-manager';
      const cur = map.get(key) ?? { manager: r.manager, rows: [], subtotal: 0 };
      cur.rows.push(r);
      cur.subtotal += r.bonus_amount_kopecks ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.manager?.full_name ?? '').localeCompare(b.manager?.full_name ?? '', 'ru'),
    );
  })();

  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Бонусы</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{currentMonthHeader()}</p>
      </div>

      {tab === 'pending' && (
        <div className="grid grid-cols-1 sm:max-w-xs">
          <Card>
            <CardContent className="grid gap-1">
              <span className="text-muted-foreground text-sm">Начислено</span>
              <span className="text-2xl font-semibold">{totalDisplay}</span>
            </CardContent>
          </Card>
        </div>
      )}

      {canManage && managers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Все менеджеры" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все менеджеры</SelectItem>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Начисленные</TabsTrigger>
          <TabsTrigger value="unmatched">Без сопоставления</TabsTrigger>
          <TabsTrigger value="paid">Выплаченные</TabsTrigger>
        </TabsList>

        {/* ── PENDING / PAID tab ──────────────────────────────────────────── */}
        {(['pending', 'paid'] as const).map((t) => (
          <TabsContent key={t} value={t}>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : rows.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6">Бонусов нет.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Менеджер</TableHead>
                    <TableHead>Вакансия</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    {canManage && <TableHead className="w-36" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <Fragment key={g.manager?.id ?? 'no-manager'}>
                      {g.rows.map((b, i) => (
                        <TableRow key={b.id}>
                          <TableCell className={cn('font-medium', i > 0 && 'text-muted-foreground')}>
                            {i === 0 ? <ManagerName name={g.manager?.full_name} isActive={g.manager?.is_active} /> : <span className="text-transparent">·</span>}
                          </TableCell>
                          <TableCell>{b.vacancy?.title ?? '—'}</TableCell>
                          <TableCell>{b.matched_position_name ?? <span className="text-muted-foreground italic text-xs">не задан</span>}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{b.bonus_date}</TableCell>
                          <TableCell className="text-right tabular-nums">{b.bonus_amount_display ?? '0 ₽'}</TableCell>
                          {canManage && (
                            <TableCell className="text-right">
                              {isAdmin && b.status === 'pending' && (
                                <Button
                                  variant="outline" size="sm"
                                  disabled={payingId === b.id}
                                  onClick={() => void handleMarkPaid(b.id)}
                                >
                                  {payingId === b.id ? <Loader2 className="size-3 animate-spin" /> : 'Выплачено'}
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/30 font-semibold">
                        <TableCell colSpan={canManage ? 4 : 4} className="text-right">Итого по {g.manager?.full_name ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKopecks(g.subtotal)}</TableCell>
                        {canManage && <TableCell />}
                      </TableRow>
                    </Fragment>
                  ))}
                  <TableRow className="bg-muted/60 font-bold">
                    <TableCell colSpan={canManage ? 4 : 4} className="text-right">Итого</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKopecks(grandTotal)}</TableCell>
                    {canManage && <TableCell />}
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </TabsContent>
        ))}

        {/* ── UNMATCHED tab ───────────────────────────────────────────────── */}
        <TabsContent value="unmatched">
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6">Все бонусы сопоставлены ✓</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Менеджер</TableHead>
                  <TableHead>Вакансия</TableHead>
                  <TableHead>Дата</TableHead>
                  {canManage && <TableHead className="w-40" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <ManagerName name={b.manager?.full_name} isActive={b.manager?.is_active} />
                    </TableCell>
                    <TableCell>{b.vacancy?.title ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.bonus_date}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => void openMatchModal(b)}>
                          Привязать тариф
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      {/* Match modal */}
      <Dialog open={!!matchBonus} onOpenChange={(o) => { if (!o) setMatchBonus(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Привязать тариф</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Вакансия: <strong>{matchBonus?.vacancy?.title ?? '—'}</strong>
          </p>
          {ratesLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="grid gap-1 max-h-60 overflow-y-auto">
              {rates.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRate(r)}
                  className={cn(
                    'flex items-center justify-between rounded px-3 py-2 text-sm text-left hover:bg-muted',
                    selectedRate?.id === r.id && 'bg-muted font-semibold',
                  )}
                >
                  <span>{r.position_name}</span>
                  <span className="text-muted-foreground tabular-nums">{r.amount_display}</span>
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchBonus(null)} disabled={matching}>Отмена</Button>
            <Button onClick={handleMatch} disabled={matching || !selectedRate}>
              {matching && <Loader2 className="size-4 animate-spin" />}
              Привязать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function currentMonthHeader(): string {
  const d = new Date();
  const month = d.toLocaleDateString('ru-RU', { month: 'long' });
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}
