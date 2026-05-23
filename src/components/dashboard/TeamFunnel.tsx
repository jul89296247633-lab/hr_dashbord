'use client';

import { ChevronRight } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface FunnelStageItem {
  label: string;
  count: number;
}

/** Горизонтальная мини-воронка отдела (7 этапов, агрегат). */
export function TeamFunnel({ stages }: { stages: FunnelStageItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Воронка отдела</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-1">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1">
              <div className="bg-muted rounded-md px-3 py-2 text-center">
                <div className="text-lg font-semibold leading-none">{s.count}</div>
                <div className="text-muted-foreground mt-1 text-xs">{s.label}</div>
              </div>
              {i < stages.length - 1 && (
                <ChevronRight className="text-muted-foreground size-4 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
