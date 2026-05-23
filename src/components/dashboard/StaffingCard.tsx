'use client';

import { useState } from 'react';
import { Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { StaffingCurrent } from '@/components/dashboard/types';

function pctColor(pct: number): string {
  if (pct >= 80) return 'text-green-600';
  if (pct >= 60) return 'text-yellow-600';
  return 'text-red-600';
}

export function StaffingCard({
  current,
  canEdit,
  onUpdated,
}: {
  current: StaffingCurrent | null;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(current?.staffing_pct ?? 0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      onUpdated();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <div className="text-muted-foreground text-sm font-medium">Укомплектованность компании</div>
          {current ? (
            <>
              <div className={cn('text-6xl font-bold', pctColor(current.staffing_pct))}>
                {current.staffing_pct}%
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Обновлено {new Date(current.recorded_at).toLocaleDateString('ru-RU')}
                {current.comment ? ` · ${current.comment}` : ''}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">Данные ещё не вносились.</p>
          )}
        </div>

        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Pencil className="size-4" />
                Обновить
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Обновить укомплектованность</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="staffing-pct">Процент (0–100)</Label>
                  <Input
                    id="staffing-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={pct}
                    onChange={(e) => setPct(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="staffing-comment">Комментарий</Label>
                  <Textarea
                    id="staffing-comment"
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
      </CardContent>
    </Card>
  );
}
