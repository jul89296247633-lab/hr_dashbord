'use client';

import { Phone, Users, FileCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Цвет бейджа по проценту выполнения (CLAUDE.md: ≥90 зелёный, 70–89 жёлтый, <70 красный). */
function pctColor(pct: number): string {
  if (pct >= 90) return 'bg-green-100 text-green-800';
  if (pct >= 70) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function pct(fact: number, plan: number): number {
  if (plan <= 0) return fact > 0 ? 100 : 0;
  return Math.round((fact / plan) * 100);
}

export interface KpiBarProps {
  callsFact: number;
  callsPlan: number;
  mangoCalls: number | null;
  hhCalls: number | null;
  interviewsFact: number;
  interviewsPlan: number;
  offersFact: number;
}

/** KPI-панель кабинета: факт/план/% по звонкам, собеседованиям + факт офферов. */
export function KpiBar({
  callsFact,
  callsPlan,
  mangoCalls,
  hhCalls,
  interviewsFact,
  interviewsPlan,
  offersFact,
}: KpiBarProps) {
  const callsPct = pct(callsFact, callsPlan);
  const interviewsPct = pct(interviewsFact, interviewsPlan);

  return (
    <div className="flex flex-wrap gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
              pctColor(callsPct),
            )}
          >
            <Phone className="size-4" />
            Звонки {callsFact}/{callsPlan}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Манго: {mangoCalls ?? 0} + HH: {hhCalls ?? 0} = {callsFact}
        </TooltipContent>
      </Tooltip>

      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
          pctColor(interviewsPct),
        )}
      >
        <Users className="size-4" />
        Собеседования {interviewsFact}/{interviewsPlan}
      </span>

      <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium">
        <FileCheck className="size-4" />
        Офферы {offersFact}
      </span>
    </div>
  );
}
