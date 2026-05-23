'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const SOURCE_LABEL: Record<string, string> = {
  hh: 'HH API',
  mango: 'Манго',
  hh_csv: 'HH CSV',
  sheets: 'Google Sheets',
};
const STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  ok: 'bg-green-100 text-green-800',
  partial: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
};

interface SyncLogRow {
  id: string;
  source: string;
  status: string;
  records_total: number;
  records_updated: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

const PER_PAGE = 20;

export function SyncLogsClient() {
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SyncLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (source !== 'all') qs.set('source', source);
      if (status !== 'all') qs.set('status', status);
      const res = await fetch(`/api/sync/logs?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [source, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(Math.ceil(total / PER_PAGE), 1);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Журнал синхронизаций</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/sync">← К синхронизации</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={source}
          onValueChange={(v) => {
            setPage(1);
            setSource(v);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Источник" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все источники</SelectItem>
            <SelectItem value="hh">HH API</SelectItem>
            <SelectItem value="mango">Манго</SelectItem>
            <SelectItem value="hh_csv">HH CSV</SelectItem>
            <SelectItem value="sheets">Google Sheets</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setPage(1);
            setStatus(v);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="running">Выполняется</SelectItem>
            <SelectItem value="ok">Успешно</SelectItem>
            <SelectItem value="partial">Частично</SelectItem>
            <SelectItem value="error">Ошибка</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{error}. Обновите страницу.</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Записей нет.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Время</TableHead>
                <TableHead>Источник</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Записей</TableHead>
                <TableHead>Ошибка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.started_at).toLocaleString('ru-RU')}
                  </TableCell>
                  <TableCell className="font-medium">{SOURCE_LABEL[r.source] ?? r.source}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        STATUS_COLOR[r.status] ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.records_updated}/{r.records_total}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[260px] truncate">
                    {r.error_message ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </Button>
              <span className="text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
