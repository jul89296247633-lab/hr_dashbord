'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  confidentiality: 'open' | 'confidential';
  title: string;
  onActivated: () => void;
}

/**
 * Модалка активации согласованной заявки.
 * Открытая: требует ввода hh_vacancy_id.
 * Конфиденциальная: подтверждение без HH ID — система сгенерирует internal_ref.
 */
export function ActivateModal({ open, onOpenChange, requestId, confidentiality, title, onActivated }: Props) {
  const [hhId, setHhId] = useState('');
  const [activating, setActivating] = useState(false);

  async function handleActivate() {
    if (confidentiality === 'open' && !/^\d+$/.test(hhId.trim())) {
      toast.error('ID на HH.ru — только цифры');
      return;
    }
    setActivating(true);
    try {
      const body = confidentiality === 'open' ? { hh_vacancy_id: hhId.trim() } : {};
      const res = await fetch(`/api/vacancies/requests/${requestId}/activate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { data?: { internal_ref?: string }; error?: { message: string } };
      if (!res.ok) { toast.error(json.error?.message ?? 'Ошибка активации'); return; }
      const ref = json.data?.internal_ref;
      toast.success(ref ? `Вакансия активирована (${ref})` : 'Вакансия активирована');
      onOpenChange(false);
      onActivated();
    } catch { toast.error('Не удалось активировать вакансию'); }
    finally { setActivating(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Активировать вакансию</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {confidentiality === 'open' ? (
          <div className="grid gap-2">
            <Label htmlFor="hh-id">ID вакансии на HH.ru *</Label>
            <Input
              id="hh-id"
              value={hhId}
              onChange={(e) => setHhId(e.target.value)}
              placeholder="131739178"
              inputMode="numeric"
              maxLength={20}
            />
            <p className="text-muted-foreground text-xs">
              Скопируйте числовой ID из URL вакансии на hh.ru
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Вакансия конфиденциальная — HH ID не требуется. Система автоматически
            присвоит внутренний идентификатор (CONF-ГГГГ-NNNN).
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={activating}>
            Отмена
          </Button>
          <Button onClick={handleActivate} disabled={activating}>
            {activating && <Loader2 className="size-4 animate-spin" />}
            Активировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
