'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Role } from '@/types';
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
import { ManagerName } from '@/components/shared/ManagerName';

const STATUS_LABEL: Record<string, string> = {
  active: 'Активна',
  paused: 'На паузе',
  closed: 'Закрыта',
  draft: 'Черновик',
};
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground',
};

interface VacancyRow {
  id: string;
  title: string;
  department: string | null;
  subdivision: string | null;
  location: string | null;
  status: string;
  opened_at: string;
  manager?: { id: string; full_name: string; is_active?: boolean } | null;
}

const PER_PAGE = 20;

export function VacanciesList({ role }: { role: Role }) {
  const canCreate = role === 'head' || role === 'admin';
  const showManager = role !== 'executive';

  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<VacancyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vacancies?status=${status}&page=${page}&per_page=${PER_PAGE}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(Math.ceil(total / PER_PAGE), 1);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Вакансии</h1>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="paused">На паузе</SelectItem>
              <SelectItem value="closed">Закрытые</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          {canCreate && (
            <Button asChild>
              <Link href="/vacancies/new">
                <Plus className="size-4" />
                Создать вакансию
              </Link>
            </Button>
          )}
        </div>
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
        <p className="text-muted-foreground text-sm">Вакансий не найдено.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Подразделение</TableHead>
                <TableHead>Город</TableHead>
                {showManager && <TableHead>Менеджер</TableHead>}
                <TableHead>Статус</TableHead>
                <TableHead>Открыта</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    <Link href={`/vacancies/${v.id}`} className="hover:underline">
                      {v.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{v.subdivision ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{v.location ?? '—'}</TableCell>
                  {showManager && (
                    <TableCell>
                      <ManagerName name={v.manager?.full_name} isActive={v.manager?.is_active} />
                    </TableCell>
                  )}
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                        STATUS_COLOR[v.status] ?? 'bg-muted text-muted-foreground',
                      )}
                    >
                      {STATUS_LABEL[v.status] ?? v.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(`${v.opened_at}T00:00:00`).toLocaleDateString('ru-RU')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
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
