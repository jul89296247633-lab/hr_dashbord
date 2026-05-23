'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

type GenType = 'anomaly' | 'forecast' | 'recommendation';

export function GenerateDialog({ onGenerated }: { onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<GenType>('anomaly');
  const [targetId, setTargetId] = useState('');
  const [managers, setManagers] = useState<{ id: string; full_name: string }[]>([]);
  const [vacancies, setVacancies] = useState<{ id: string; title: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const needsVacancy = type === 'recommendation';

  useEffect(() => {
    if (!open) return;
    fetch('/api/dashboard/team?period=month')
      .then((r) => r.json())
      .then((j) =>
        setManagers(
          (j.data?.managers ?? [])
            .filter((m: { id?: string; full_name?: string }) => m.id && m.full_name)
            .map((m: { id: string; full_name: string }) => ({ id: m.id, full_name: m.full_name })),
        ),
      )
      .catch(() => undefined);
    fetch('/api/vacancies?status=active&per_page=100')
      .then((r) => r.json())
      .then((j) =>
        setVacancies((j.data ?? []).map((v: { id: string; title: string }) => ({ id: v.id, title: v.title }))),
      )
      .catch(() => undefined);
  }, [open]);

  async function handleGenerate() {
    if (!targetId) {
      toast.error(needsVacancy ? 'Выберите вакансию' : 'Выберите менеджера');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { type };
      if (needsVacancy) body.vacancy_id = targetId;
      else body.manager_id = targetId;

      const res = await fetch('/api/ai/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка генерации. Попробуйте позже.');
        return;
      }
      toast.success('Инсайт сгенерирован');
      setOpen(false);
      setTargetId('');
      onGenerated();
    } catch {
      toast.error('Ошибка генерации. Попробуйте позже.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTargetId('');
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Sparkles className="size-4" />
          Обновить анализ
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сгенерировать AI-инсайт</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Тип</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v as GenType);
                setTargetId('');
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anomaly">Аномалия (по менеджеру)</SelectItem>
                <SelectItem value="forecast">Прогноз (по менеджеру)</SelectItem>
                <SelectItem value="recommendation">Рекомендация (по вакансии)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{needsVacancy ? 'Вакансия' : 'Менеджер'}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={needsVacancy ? 'Выберите вакансию' : 'Выберите менеджера'} />
              </SelectTrigger>
              <SelectContent>
                {needsVacancy
                  ? vacancies.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.title}
                      </SelectItem>
                    ))
                  : managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleGenerate} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Сгенерировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
