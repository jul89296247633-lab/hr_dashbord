'use client';

import {
  Briefcase,
  Phone,
  Users,
  UserCheck,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { KpiMetric } from '@/types';

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-green-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-red-500';
}

function KpiCard({
  icon: Icon,
  label,
  metric,
}: {
  icon: LucideIcon;
  label: string;
  metric: KpiMetric | { fact: number };
}) {
  const hasPlan = 'plan' in metric && metric.plan > 0;
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4" />
          {label}
        </div>
        <div className="text-2xl font-semibold">
          {metric.fact}
          {hasPlan && <span className="text-muted-foreground text-base"> / {metric.plan}</span>}
        </div>
        {hasPlan && (
          <Progress
            value={Math.min(metric.pct, 100)}
            indicatorClassName={cn(barColor(metric.pct))}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function KpiCards({
  activeVacancies,
  calls,
  interviews,
  hired,
  interns,
}: {
  activeVacancies: number;
  calls: KpiMetric;
  interviews: KpiMetric;
  hired: KpiMetric;
  interns: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard icon={Briefcase} label="Активных вакансий" metric={{ fact: activeVacancies }} />
      <KpiCard icon={Phone} label="Звонки" metric={calls} />
      <KpiCard icon={Users} label="Собеседования" metric={interviews} />
      {/* «Закрыто вакансий» показываем только факт за текущий месяц —
          план из manager_plans (или дефолт 15) суммируется по всем менеджерам
          и выходит цифра в районе 300, никакого общекомпанийного плана у нас
          нет. Сравнение факт/план для конкретного менеджера остаётся на
          /dashboard/manager + /dashboard/efficiency. */}
      <KpiCard icon={UserCheck} label="Закрыто вакансий" metric={{ fact: hired.fact }} />
      <KpiCard icon={GraduationCap} label="На стажировке" metric={{ fact: interns }} />
    </div>
  );
}
