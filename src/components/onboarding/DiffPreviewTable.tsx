'use client';

import { useState } from 'react';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorRowList } from '@/components/onboarding/ErrorRowList';
import type { UploadPreviewResult } from '@/components/onboarding/TemplateUploadZone';

const SHEET_LABELS: Record<string, string> = {
  data: 'Вакансии (Data)',
  bonus_rates: 'Бонусы_HR',
  hr_list: 'Список HR',
  staffing_plan: 'Штатное расписание',
};

interface Props {
  result: UploadPreviewResult;
  onApplied: (inserted: number, updated: number) => void;
  onReset: () => void;
}

/**
 * Шаг 3: таблица превью (insert/update/skip/error по листам) + кнопка подтверждения.
 * POST /api/templates/upload/[id]/apply → запись в БД.
 */
export function DiffPreviewTable({ result, onApplied, onReset }: Props) {
  const [applying, setApplying] = useState(false);

  const sheets = Object.entries(result.preview) as Array<
    [string, { insert: number; update: number; skip: number; error: number }]
  >;

  const totalInsert = sheets.reduce((s, [, c]) => s + c.insert, 0);
  const totalUpdate = sheets.reduce((s, [, c]) => s + c.update, 0);
  const totalError = sheets.reduce((s, [, c]) => s + c.error, 0);
  const hasChanges = totalInsert + totalUpdate > 0;

  async function handleApply() {
    setApplying(true);
    try {
      const res = await fetch(`/api/templates/upload/${result.upload_id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip_errors: true }),
      });
      const json = await res.json() as {
        data?: { inserted: number; updated: number };
        error?: { code: string; message: string };
      };

      if (!res.ok) {
        if (json.error?.code === 'UPLOAD_EXPIRED') {
          toast.error('Превью устарело. Загрузите файл заново.');
          onReset();
          return;
        }
        toast.error(json.error?.message ?? 'Ошибка применения данных');
        return;
      }
      onApplied(json.data?.inserted ?? 0, json.data?.updated ?? 0);
    } catch {
      toast.error('Не удалось применить данные. Проверьте соединение.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Шаг 3 — Проверьте и подтвердите</CardTitle>
        <CardDescription>
          Убедитесь, что данные корректны, затем нажмите «Применить».
          Строки с ошибками будут пропущены.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {result.warning && (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertTitle>Предупреждение</AlertTitle>
            <AlertDescription>{result.warning}</AlertDescription>
          </Alert>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Лист</TableHead>
              <TableHead className="text-right">Добавить</TableHead>
              <TableHead className="text-right">Обновить</TableHead>
              <TableHead className="text-right">Пропустить</TableHead>
              <TableHead className="text-right">Ошибок</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheets.map(([key, counts]) => (
              <TableRow key={key}>
                <TableCell className="font-medium">
                  {SHEET_LABELS[key] ?? key}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {counts.insert > 0 ? (
                    <Badge variant="secondary" className="text-green-700">
                      +{counts.insert}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {counts.update > 0 ? (
                    <Badge variant="secondary" className="text-blue-700">
                      ~{counts.update}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {counts.skip}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {counts.error > 0 ? (
                    <Badge variant="destructive">{counts.error}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {result.errors.length > 0 && <ErrorRowList errors={result.errors} />}

        {!hasChanges && (
          <p className="text-muted-foreground text-center text-sm">
            Нет новых данных для применения — все строки уже в БД или содержат ошибки.
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onReset} disabled={applying}>
            Загрузить другой файл
          </Button>
          {totalError > 0 && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/templates/upload/${result.upload_id}/error-report`} download>
                <Download className="size-4" />
                Отчёт об ошибках
              </a>
            </Button>
          )}
        </div>
        <Button onClick={handleApply} disabled={applying || !hasChanges}>
          {applying && <Loader2 className="size-4 animate-spin" />}
          Применить{hasChanges ? ` (${totalInsert + totalUpdate} строк)` : ''}
        </Button>
      </CardFooter>
    </Card>
  );
}
