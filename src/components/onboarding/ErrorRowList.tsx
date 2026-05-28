'use client';

import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface TemplateErrorRow {
  sheet: string;
  row: number;
  column: string;
  reason: string;
}

const SHEET_LABELS: Record<string, string> = {
  Data: 'Вакансии',
  'Бонусы_HR': 'Бонусы',
  'Список HR': 'HR-список',
  'Штатное расписание': 'Штатное расп.',
};

export function ErrorRowList({ errors }: { errors: TemplateErrorRow[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-xs">
        {errors.length} {errors.length === 1 ? 'строка пропущена' : 'строк пропущено'} — исправьте и загрузите повторно
      </p>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {errors.map((e, i) => (
          <div
            key={i}
            className="border-b px-3 py-2 last:border-0 odd:bg-muted/30"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Badge variant="outline" className="shrink-0 text-xs">
                {SHEET_LABELS[e.sheet] ?? e.sheet}
              </Badge>
              <span className="text-muted-foreground text-xs">строка {e.row}</span>
              <span className="text-xs font-medium">{e.column}</span>
              <AlertTriangle className="text-destructive size-3 shrink-0" />
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">{e.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
