'use client';

import { useEffect, useState } from 'react';
import { Loader2, Link2 } from 'lucide-react';
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

interface VacancyOption {
  id: string;
  title: string;
}

/** Ручная привязка бонуса к вакансии (head/admin): PATCH /api/bonuses/[id]/match. */
export function MatchDialog({ bonusId, onMatched }: { bonusId: string; onMatched: () => void }) {
  const [open, setOpen] = useState(false);
  const [vacancies, setVacancies] = useState<VacancyOption[]>([]);
  const [vacancyId, setVacancyId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Список вакансий грузим при первом открытии.
  useEffect(() => {
    if (!open || vacancies.length > 0) return;
    fetch('/api/vacancies?status=all&per_page=100')
      .then((r) => r.json())
      .then((j) => setVacancies((j.data ?? []).map((v: VacancyOption) => ({ id: v.id, title: v.title }))))
      .catch(() => toast.error('Не удалось загрузить вакансии'));
  }, [open, vacancies.length]);

  async function handleMatch() {
    if (!vacancyId) {
      toast.error('Выберите вакансию');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bonuses/${bonusId}/match`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vacancy_id: vacancyId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка привязки');
        return;
      }
      toast.success('Бонус привязан к вакансии');
      setOpen(false);
      onMatched();
    } catch {
      toast.error('Ошибка привязки');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="size-4" />
          Привязать
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Привязать бонус к вакансии</DialogTitle>
        </DialogHeader>
        <Select value={vacancyId} onValueChange={setVacancyId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Выберите вакансию" />
          </SelectTrigger>
          <SelectContent>
            {vacancies.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button onClick={handleMatch} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Привязать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
