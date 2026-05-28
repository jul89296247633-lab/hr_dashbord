'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TemplateErrorRow } from '@/components/onboarding/ErrorRowList';

export interface UploadPreviewResult {
  upload_id: string;
  warning?: string;
  preview: Partial<Record<string, { insert: number; update: number; skip: number; error: number }>>;
  errors: TemplateErrorRow[];
}

interface Props {
  onPreviewReady: (result: UploadPreviewResult) => void;
}

/**
 * Шаг 2: drag-n-drop зона загрузки XLSX.
 * POST /api/templates/upload → multipart/form-data.
 * При успехе вызывает onPreviewReady с данными превью.
 */
export function TemplateUploadZone({ onPreviewReady }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        toast.error('Файл должен быть в формате .xlsx');
        return;
      }
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/templates/upload', { method: 'POST', body: formData });
        const json = await res.json() as { data?: UploadPreviewResult; error?: { message: string } };

        if (!res.ok) {
          toast.error(json.error?.message ?? 'Ошибка загрузки файла');
          return;
        }
        if (json.data?.warning) {
          toast.warning(json.data.warning);
        }
        onPreviewReady(json.data!);
      } catch {
        toast.error('Не удалось загрузить файл. Проверьте соединение.');
      } finally {
        setUploading(false);
      }
    },
    [onPreviewReady],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // сбрасываем input, чтобы можно было повторно выбрать тот же файл
    e.target.value = '';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Шаг 2 — Загрузите заполненный файл</CardTitle>
        <CardDescription>
          Перетащите XLSX-файл или нажмите кнопку выбора. После загрузки вы увидите
          превью: сколько строк будет добавлено, обновлено или пропущено из-за ошибок.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
            uploading && 'pointer-events-none opacity-60',
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="text-muted-foreground size-8 animate-spin" />
              <p className="text-muted-foreground text-sm">Загрузка и анализ файла…</p>
            </>
          ) : (
            <>
              <UploadCloud className="text-muted-foreground size-8" />
              <div>
                <p className="text-sm font-medium">Перетащите XLSX-файл сюда</p>
                <p className="text-muted-foreground text-xs">или</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                Выбрать файл
              </Button>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onInputChange}
        />
      </CardContent>
    </Card>
  );
}
