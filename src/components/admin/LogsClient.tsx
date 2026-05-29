'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Check } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function LogsClient() {
  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-semibold">Журналы</h1>
      <Tabs defaultValue="errors">
        <TabsList>
          <TabsTrigger value="errors">Ошибки</TabsTrigger>
          <TabsTrigger value="audit">Аудит</TabsTrigger>
        </TabsList>
        <TabsContent value="errors" className="pt-4">
          <ErrorsTab />
        </TabsContent>
        <TabsContent value="audit" className="pt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Ошибки ───────────────────────────────────────────────────────────────────
const SEVERITY: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  error: 'bg-orange-100 text-orange-800',
  warning: 'bg-yellow-100 text-yellow-800',
};

interface ErrorLog {
  id: string;
  source: string;
  severity: string;
  error_code: string | null;
  message: string;
  stack_trace: string | null;
  context: unknown;
  http_method: string | null;
  http_path: string | null;
  http_status: number | null;
  resolved: boolean;
  created_at: string;
}

function ErrorsTab() {
  const [severity, setSeverity] = useState('all');
  const [resolved, setResolved] = useState('all');
  const [rows, setRows] = useState<ErrorLog[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ per_page: '50' });
      if (severity !== 'all') qs.set('severity', severity);
      if (resolved !== 'all') qs.set('resolved', resolved === 'resolved' ? 'true' : 'false');
      const res = await fetch(`/api/admin/error-logs?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка загрузки');
        return;
      }
      setRows(json.data ?? []);
      setUnresolved(json.meta?.unresolved ?? 0);
    } finally {
      setLoading(false);
    }
  }, [severity, resolved]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string) {
    const res = await fetch(`/api/admin/error-logs/${id}/resolve`, { method: 'PATCH' });
    if (!res.ok) {
      toast.error('Не удалось отметить решённой');
      return;
    }
    toast.success('Отмечено решённой');
    void load();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
          Нерешённых: {unresolved}
        </span>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Серьёзность" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все уровни</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resolved} onValueChange={setResolved}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="unresolved">Только нерешённые</SelectItem>
            <SelectItem value="resolved">Только решённые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle className="size-4 text-green-600" />
          Ошибок нет — всё работает.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Время</TableHead>
              <TableHead>Источник</TableHead>
              <TableHead>Серьёзность</TableHead>
              <TableHead>Код</TableHead>
              <TableHead>Сообщение</TableHead>
              <TableHead className="text-right">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('ru-RU')}
                </TableCell>
                <TableCell>{r.source}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                      SEVERITY[r.severity] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {r.severity}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{r.error_code ?? '—'}</TableCell>
                <TableCell className="max-w-[280px]">
                  <Sheet>
                    <SheetTrigger asChild>
                      <button className="truncate text-left hover:underline">{r.message}</button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-[480px] overflow-y-auto p-4 sm:max-w-[480px]">
                      <SheetHeader className="p-0">
                        <SheetTitle>{r.error_code ?? 'Ошибка'}</SheetTitle>
                        <SheetDescription>{r.source}</SheetDescription>
                      </SheetHeader>
                      <div className="mt-4 grid gap-3 text-sm">
                        <p>{r.message}</p>
                        {r.http_path && (
                          <p className="text-muted-foreground text-xs">
                            {r.http_method} {r.http_path} → {r.http_status}
                          </p>
                        )}
                        {r.stack_trace && (
                          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
                            {r.stack_trace}
                          </pre>
                        )}
                        {r.context != null && (
                          <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
                            {JSON.stringify(r.context, null, 2)}
                          </pre>
                        )}
                        {!r.resolved && (
                          <Button size="sm" onClick={() => resolve(r.id)}>
                            <Check className="size-4" />
                            Отметить решённой
                          </Button>
                        )}
                      </div>
                    </SheetContent>
                  </Sheet>
                </TableCell>
                <TableCell className="text-right">
                  {r.resolved ? (
                    <span className="inline-flex rounded-md bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Решена
                    </span>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => resolve(r.id)}>
                      <Check className="size-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ── Аудит ────────────────────────────────────────────────────────────────────
const ACTION_COLOR: Record<string, string> = {
  INSERT: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  DELETE: 'bg-red-100 text-red-800',
};

interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
  user: { id: string; full_name: string; role: string } | null;
}

function diffSummary(a: AuditLog): string {
  const keys = Object.keys(a.new_values ?? a.old_values ?? {});
  if (keys.length === 0) return '—';
  return keys
    .slice(0, 3)
    .map((k) => {
      const oldV = a.old_values?.[k];
      const newV = a.new_values?.[k];
      if (a.action === 'UPDATE') return `${k}: ${String(oldV)} → ${String(newV)}`;
      return k;
    })
    .join(', ');
}

function AuditTab() {
  const [table, setTable] = useState('all');
  const [action, setAction] = useState('all');
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ per_page: '50' });
      if (table !== 'all') qs.set('table_name', table);
      if (action !== 'all') qs.set('action', action);
      const res = await fetch(`/api/admin/audit-logs?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка загрузки');
        return;
      }
      setRows(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [table, action]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={table} onValueChange={setTable}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Таблица" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все таблицы</SelectItem>
            <SelectItem value="vacancies">vacancies</SelectItem>
            <SelectItem value="user_profiles">user_profiles</SelectItem>
            <SelectItem value="manager_plans">manager_plans</SelectItem>
            <SelectItem value="staffing_records">staffing_records</SelectItem>
            <SelectItem value="hired_employees">hired_employees</SelectItem>
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все действия</SelectItem>
            <SelectItem value="INSERT">INSERT</SelectItem>
            <SelectItem value="UPDATE">UPDATE</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Записей нет.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Время</TableHead>
              <TableHead>Пользователь</TableHead>
              <TableHead>Таблица</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Что изменилось</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('ru-RU')}
                </TableCell>
                <TableCell>{r.user?.full_name ?? 'Система (cron)'}</TableCell>
                <TableCell className="text-muted-foreground">{r.table_name}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                      ACTION_COLOR[r.action] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {r.action}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[320px] truncate">
                  {diffSummary(r)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
