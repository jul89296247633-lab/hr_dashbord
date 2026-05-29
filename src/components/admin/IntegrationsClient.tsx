'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Link2, Trash2, FileSpreadsheet, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type TokenStatus = 'active' | 'expiring' | 'expired' | 'none';
interface HhManager {
  manager_id: string;
  full_name: string;
  hh_manager_id: string | null;
  status: TokenStatus;
  expires_at: string | null;
}

const STATUS: Record<TokenStatus, { label: string; className: string }> = {
  active: { label: 'Активен', className: 'bg-green-100 text-green-800' },
  expiring: { label: 'Истекает', className: 'bg-yellow-100 text-yellow-800' },
  expired: { label: 'Истёк', className: 'bg-red-100 text-red-800' },
  none: { label: 'Не подключён', className: 'bg-muted text-muted-foreground' },
};

interface SheetsResult {
  ok: boolean;
  sheet_title?: string;
  total_rows?: number;
  headers_found?: string[];
  error?: string;
  hint?: string;
}

const HH_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  hh_denied: 'Авторизация HH отменена пользователем',
  hh_invalid: 'Некорректный ответ от HH',
  hh_oauth: 'Ошибка при получении токена HH',
  hh_config: 'HH OAuth не настроен на сервере',
  hh_manager_not_found: 'Менеджер не найден в системе',
};

export function IntegrationsClient() {
  const [managers, setManagers] = useState<HhManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/integrations/hh');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setManagers(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  // Первоначальная загрузка
  useEffect(() => {
    void load();
  }, [load]);

  // Обрабатываем query-params после OAuth-редиректа.
  // router.replace — soft-navigation, load() нужно вызвать явно для обновления статусов.
  useEffect(() => {
    const connected = searchParams.get('connected');
    const hhError = searchParams.get('error');
    if (connected === '1') {
      toast.success('HH-токен подключён успешно');
      router.replace('/admin/integrations');
      void load();
    } else if (hhError) {
      toast.error(HH_OAUTH_ERROR_MESSAGES[hhError] ?? 'Ошибка подключения HH');
      router.replace('/admin/integrations');
    }
  }, [searchParams, router, load]);

  async function revoke(managerId: string) {
    try {
      const res = await fetch(`/api/admin/integrations/hh/${managerId}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        toast.error(json?.error?.message ?? 'Ошибка');
        return;
      }
      toast.success('Токен отозван');
      void load();
    } catch {
      toast.error('Ошибка');
    }
  }

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">Интеграции</h1>

      {/* HH.ru */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">HH.ru — OAuth-токены менеджеров</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle />
              <AlertTitle>Ошибка</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : managers.length === 0 ? (
            <p className="text-muted-foreground text-sm">Менеджеров нет.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Менеджер</TableHead>
                  <TableHead>Статус токена</TableHead>
                  <TableHead>Истекает</TableHead>
                  <TableHead className="text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managers.map((m) => (
                  <TableRow key={m.manager_id}>
                    <TableCell className="font-medium">{m.full_name}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
                          STATUS[m.status].className,
                        )}
                      >
                        {STATUS[m.status].label}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.expires_at ? new Date(m.expires_at).toLocaleDateString('ru-RU') : '—'}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Подключить через HH (OAuth)"
                        title="Подключить через HH (OAuth)"
                        onClick={() => {
                          window.location.href = `/api/auth/hh/start?manager_id=${m.manager_id}`;
                        }}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                      <HhConnectDialog managerId={m.manager_id} managerName={m.full_name} onDone={load} />
                      {m.status !== 'none' && (
                        <Button variant="ghost" size="icon" onClick={() => revoke(m.manager_id)} aria-label="Отозвать">
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Google Sheets */}
      <SheetsCard />
    </div>
  );
}

function HhConnectDialog({
  managerId,
  managerName,
  onDone,
}: {
  managerId: string;
  managerName: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [expiresIn, setExpiresIn] = useState('');
  const [hhManagerId, setHhManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleConnect() {
    if (!accessToken.trim()) {
      toast.error('Введите access_token');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { access_token: accessToken.trim() };
      if (refreshToken.trim()) body.refresh_token = refreshToken.trim();
      if (expiresIn.trim()) body.expires_in = Number(expiresIn);
      if (hhManagerId.trim()) body.hh_manager_id = hhManagerId.trim();

      const res = await fetch(`/api/admin/integrations/hh/${managerId}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения токена');
        return;
      }
      toast.success('Токен сохранён');
      setOpen(false);
      setAccessToken('');
      setRefreshToken('');
      setExpiresIn('');
      setHhManagerId('');
      onDone();
    } catch {
      toast.error('Ошибка сохранения токена');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Подключить токен">
          <Link2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>HH-токен: {managerName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="acc">access_token</Label>
            <Input id="acc" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ref">refresh_token</Label>
            <Input id="ref" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exp">expires_in (сек)</Label>
            <Input id="exp" type="number" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="hhid">hh_manager_id</Label>
            <Input id="hhid" value={hhManagerId} onChange={(e) => setHhManagerId(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleConnect} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetsCard() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SheetsResult | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/integrations/sheets/test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка проверки');
        return;
      }
      setResult(json.data as SheetsResult);
    } catch {
      toast.error('Ошибка проверки');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Google Sheets</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button variant="outline" size="sm" className="w-fit" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          Проверить доступ
        </Button>
        {result &&
          (result.ok ? (
            <Alert>
              <FileSpreadsheet />
              <AlertTitle>Доступ есть</AlertTitle>
              <AlertDescription>
                Лист «{result.sheet_title}», строк: {result.total_rows}. Заголовки:{' '}
                {result.headers_found?.join(', ')}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Нет доступа</AlertTitle>
              <AlertDescription>
                {result.error}. {result.hint}
              </AlertDescription>
            </Alert>
          ))}
      </CardContent>
    </Card>
  );
}
