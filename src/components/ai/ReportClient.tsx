'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Printer, ArrowLeft } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Markdown } from '@/components/ui/markdown';

interface Report {
  id: string;
  title: string;
  body_md: string;
  meta_json: Record<string, unknown> | null;
  week: string;
  period: string;
  created_at: string;
}

export function ReportClient({ week }: { week: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/ai/report/${week}`);
      const json = await res.json();
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setReport(json.data as Report);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (notFound || !report) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="text-muted-foreground size-8" />
          <p className="font-medium">Отчёт за неделю {week} ещё не сгенерирован</p>
          <Button asChild variant="outline">
            <Link href="/ai">
              <ArrowLeft className="size-4" />К инсайтам
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="text-muted-foreground flex items-center gap-1 text-sm">
        <Link href="/ai" className="hover:underline">
          AI-инсайты
        </Link>
        <span>/</span>
        <span className="text-foreground">Отчёт за {report.period}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{report.title}</h1>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" />
          Распечатать
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent>
            <Markdown>{report.body_md}</Markdown>
          </CardContent>
        </Card>

        {report.meta_json && Object.keys(report.meta_json).length > 0 && (
          <Card className="h-fit lg:sticky lg:top-20">
            <CardContent className="grid gap-2 text-sm">
              {Object.entries(report.meta_json).map(([k, v]) => (
                <div key={k} className="grid">
                  <span className="text-muted-foreground text-xs">{k}</span>
                  <span className="font-medium">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
