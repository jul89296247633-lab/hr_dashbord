'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Локальная дата → YYYY-MM-DD. */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Выбор даты кабинета. Блокирует будущее (даты старше 30 дней доступны для просмотра).
 * При выборе → переход на /cabinet/YYYY-MM-DD.
 */
export function DatePicker({ date }: { date: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const selected = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[220px] justify-start gap-2 font-normal">
          <CalendarIcon className="size-4" />
          {format(selected, 'd MMMM yyyy', { locale: ru })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={{ after: today }}
          onSelect={(d) => {
            if (!d) return;
            setOpen(false);
            router.push(`/cabinet/${toIso(d)}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
