'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface StaffingRecord {
  id: string;
  staffing_pct: number;
  comment: string | null;
  recorded_at: string;
  recorded_by: { id: string; full_name: string } | null;
}
interface StaffingData {
  current: StaffingRecord | null;
  history: StaffingRecord[];
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'text-green-600';
  if (pct >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function StaffingClient({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<StaffingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/staffing');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setData(json.data as StaffingData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (pct < 0 || pct > 100) {
      toast.error('Значение от 0 до 100');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/staffing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffing_pct: pct, comment: comment.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения');
        return;
      }
      toast.success('Укомплектованность обновлена');
      setOpen(false);
      setComment('');
      await load();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  }

  const current = data?.current ?? null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Укомплектованность</h1>
        {canEdit && (
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (o) setPct(current?.staffing_pct ?? 0);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Pencil className="size-4" />
                Обновить %
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Обновить укомплектованность</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="pct">Процент (0–100)</Label>
                  <Input
                    id="pct"
                    type="number"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => setPct(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="comment">Комментарий</Label>
                  <Textarea
                    id="comment"
                    rows={3}
                    maxLength={500}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Что изменилось?"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={submitting}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Сохранить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
        <>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              {current ? (
                <>
                  <div className={cn('text-8xl font-bold', pctColor(current.staffing_pct))}>
                    {current.staffing_pct}%
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Обновлено {new Date(current.recorded_at).toLocaleDateString('ru-RU')}
                    {current.comment ? ` · ${current.comment}` : ''}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  % укомплектованности ещё не установлен{canEdit ? ' — нажмите «Обновить %».' : '.'}
                </p>
              )}
            </CardContent>
          </Card>

          {(data?.history.length ?? 0) > 0 && (
            <div className="grid gap-3">
              <h2 className="text-lg font-semibold">История</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Комментарий</TableHead>
                    <TableHead>Кто обновил</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.history.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">
                        {new Date(r.recorded_at).toLocaleDateString('ru-RU')}
                      </TableCell>
                      <TableCell className={cn('font-medium', pctColor(r.staffing_pct))}>
                        {r.staffing_pct}%
                      </TableCell>
                      <TableCell>{r.comment ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.recorded_by?.full_name ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
