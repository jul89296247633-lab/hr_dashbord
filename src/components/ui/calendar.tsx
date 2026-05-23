'use client';

import 'react-day-picker/style.css';
import { DayPicker } from 'react-day-picker';
import { ru } from 'date-fns/locale';

import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Календарь на базе react-day-picker (v10) с русской локалью.
 * Использует базовые стили библиотеки + акцентный цвет темы.
 */
function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={ru}
      showOutsideDays
      className={cn('p-2 [--rdp-accent-color:var(--primary)]', className)}
      {...props}
    />
  );
}

export { Calendar };
