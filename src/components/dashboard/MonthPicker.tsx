'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Список последних 12 месяцев + текущий, формат `YYYY-MM`. Сегодня первое. */
export function buildMonthOptions(now: Date = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 13; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const month = d.toLocaleDateString('ru-RU', { month: 'long' });
    const label = `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
    out.push({ value: ym, label });
  }
  return out;
}

/** Текущий месяц в формате `YYYY-MM`. */
export function currentMonthYM(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** MonthPicker — выпадающий список последних 12 месяцев + текущий.
 *  При выборе вызывает onChange(YYYY-MM). Используется в /dashboard. */
export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (ym: string) => void;
}) {
  const options = buildMonthOptions();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
