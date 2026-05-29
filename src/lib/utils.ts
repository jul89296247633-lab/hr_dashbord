import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Объединяет классы Tailwind с разрешением конфликтов (shadcn/ui). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Сумма в рублях (строка из Sheets/XLSX) → копейки INTEGER. '50 000', '50000,50' → 5000000. */
export function rublesToKopecks(value: string): number {
  const cleaned = (value ?? '').replace(/\s/g, '').replace(',', '.');
  const rub = Number.parseFloat(cleaned);
  if (!Number.isFinite(rub)) return 0;
  return Math.round(rub * 100);
}
