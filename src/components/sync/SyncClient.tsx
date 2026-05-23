'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  Loader2,
  Phone,
  Star,
  Briefcase,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type CsvType = 'vacancies' | 'politeness_managers';

// HH перестал отдавать отдельные CSV «звонки» и «индекс компании»:
//  - звонки менеджера → теперь в файле вакансий (колонка «Звонки»);
//  - индекс компании → weighted average по менеджерам, считается в /api/stats/politeness.
const CSV_ZONES: {
  type: CsvType;
  label: string;
  icon: typeof Phone;
  description: string;
  fileHint: string;
}[] = [
  {
    type: 'vacancies',
    label: 'Аналитика вакансий',
    icon: Briefcase,
    description: 'Воронка по вакансиям — показы, отклики, приглашения, звонки',
    fileHint: 'recruitment_analytics_vacancies_*.csv',
  },
  {
    type: 'politeness_managers',
    label: 'Статистика менеджеров',
    icon: Star,
    description: 'Индекс вежливости и активность менеджеров',
    fileHint: 'recruitment_analytics_managers_statistics_*.csv',
  },
];

interface SyncLog {
  status: string;
  records_total: number;
  records_updated: number;
  finished_at: string | null;
  started_at: string;
}

export function SyncClient() {
  const [hhStatus, setHhStatus] = useState<SyncLog | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const loadHhStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/hh');
      const json = await res.json();
      if (res.ok) setHhStatus((json.data as SyncLog | null) ?? null);
    } catch {
      // статус необязателен
    }
  }, []);

  useEffect(() => {
    void loadHhStatus();
  }, [loadHhStatus]);

  async function runSync(key: string, url: string) {
    setRunning(key);
    try {
      const res = await fetch(url, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка синхронизации');
        return;
      }
      const d = json.data ?? {};
      toast.success(
        `Готово: обновлено ${d.records_updated ?? d.closed ?? 0} записей`,
      );
      if (key === 'hh') await loadHhStatus();
    } catch {
      toast.error('Ошибка синхронизации');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Синхронизация</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/sync/logs">Журнал →</Link>
        </Button>
      </div>

      {/* Автоматические синхронизации */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ActionCard
          icon={RefreshCw}
          title="HH.ru API"
          description={
            hhStatus
              ? `Последний запуск: ${hhStatus.status}, обновлено ${hhStatus.records_updated}${
                  hhStatus.finished_at
                    ? ` · ${new Date(hhStatus.finished_at).toLocaleString('ru-RU')}`
                    : ''
                }`
              : 'Запусков ещё не было'
          }
          loading={running === 'hh'}
          onRun={() => runSync('hh', '/api/sync/hh')}
        />
        <ActionCard
          icon={FileSpreadsheet}
          title="Google Sheets"
          description="Вакансии, менеджеры, бонусы"
          loading={running === 'sheets'}
          onRun={() => runSync('sheets', '/api/sync/sheets')}
        />
        <ActionCard
          icon={Phone}
          title="Манго ВАТС"
          description="Звонки менеджеров за сегодня"
          loading={running === 'mango'}
          onRun={() => runSync('mango', '/api/sync/mango')}
        />
      </div>

      {/* Загрузка CSV */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Загрузка CSV из HH.ru → Аналитика подбора</CardTitle>
          <p className="text-muted-foreground text-sm">
            Скачайте нужный отчёт в HH и загрузите файл — данные сопоставятся с менеджерами.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {CSV_ZONES.map((z) => (
              <CsvUploadCard
                key={z.type}
                type={z.type}
                label={z.label}
                icon={z.icon}
                description={z.description}
                fileHint={z.fileHint}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  description,
  loading,
  onRun,
}: {
  icon: typeof Phone;
  title: string;
  description: string;
  loading: boolean;
  onRun: () => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2 font-medium">
          <Icon className="size-4" />
          {title}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
        <Button size="sm" variant="outline" onClick={onRun} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Синхронизировать
        </Button>
      </CardContent>
    </Card>
  );
}

function CsvUploadCard({
  type,
  label,
  icon: Icon,
  description,
  fileHint,
}: {
  type: CsvType;
  label: string;
  icon: typeof Phone;
  description: string;
  fileHint: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [statDate, setStatDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) {
      toast.error('Выберите CSV-файл');
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/sync/hh-csv?type=${type}&stat_date=${statDate}`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка загрузки CSV');
        return;
      }
      const d = json.data ?? {};
      const matched = d.rows_matched ?? 0;
      const skipped = d.rows_skipped ?? 0;
      setResult(`Сопоставлено: ${matched}${skipped ? `, пропущено: ${skipped}` : ''}`);
      toast.success('CSV загружен');
    } catch {
      toast.error('Ошибка загрузки CSV');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4" />
          {label}
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
        <p className="text-muted-foreground font-mono text-[11px]">{fileHint}</p>
        <div className="grid gap-2">
          <Label htmlFor={`file-${type}`} className="text-xs">
            CSV-файл
          </Label>
          <Input
            id={`file-${type}`}
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`date-${type}`} className="text-xs">
            Дата отчёта
          </Label>
          <Input
            id={`date-${type}`}
            type="date"
            value={statDate}
            onChange={(e) => setStatDate(e.target.value)}
          />
        </div>
        <Button size="sm" onClick={handleUpload} disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Загрузить
        </Button>
        {result && <p className="text-xs text-green-700">{result}</p>}
      </CardContent>
    </Card>
  );
}
