'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ManagerStatus } from '@/types';
import type { TeamManagerKpi } from '@/components/dashboard/types';
import { ImpersonateButton } from '@/components/shared/ImpersonateButton';

const STATUS: Record<ManagerStatus, { label: string; className: string }> = {
  on_track: { label: 'В плане', className: 'bg-green-100 text-green-800' },
  lagging: { label: 'Отставание', className: 'bg-yellow-100 text-yellow-800' },
  critical: { label: 'Критично', className: 'bg-red-100 text-red-800' },
};

function ivColor(iv: number): string {
  if (iv >= 85) return 'text-green-600';
  if (iv >= 70) return 'text-yellow-600';
  return 'text-red-600';
}

export function TeamTable({
  managers,
  politenessById,
  canImpersonate = false,
}: {
  managers: TeamManagerKpi[];
  politenessById: Record<string, number | null>;
  canImpersonate?: boolean;
}) {
  const top = managers.slice(0, 5);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Эффективность менеджеров</h2>
        <Link href="/dashboard/efficiency" className="text-sm text-primary hover:underline">
          Показать всех →
        </Link>
      </div>

      {top.length === 0 ? (
        <p className="text-muted-foreground text-sm">Данных за выбранный период нет.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Менеджер</TableHead>
              <TableHead>Звонки</TableHead>
              <TableHead>Собеседования</TableHead>
              <TableHead>Закрыто вакансий</TableHead>
              <TableHead>ИВ</TableHead>
              <TableHead>Статус</TableHead>
              {canImpersonate && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {top.map((m) => {
              const iv = m.id ? politenessById[m.id] : null;
              const status = STATUS[m.status];
              return (
                <TableRow key={m.id ?? m.full_name}>
                  <TableCell className="font-medium">{m.full_name ?? '—'}</TableCell>
                  <TableCell>{m.calls.pct}%</TableCell>
                  <TableCell>{m.interviews.pct}%</TableCell>
                  <TableCell>
                    {m.hired.fact}/{m.hired.plan}
                  </TableCell>
                  <TableCell>
                    {typeof iv === 'number' ? (
                      <span className={cn('font-medium', ivColor(iv))}>{Math.round(iv)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        status.className,
                      )}
                    >
                      {status.label}
                    </span>
                  </TableCell>
                  {canImpersonate && (
                    <TableCell className="text-right">
                      {m.id && m.full_name && (
                        <ImpersonateButton managerId={m.id} managerName={m.full_name} />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
