'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Markdown } from '@/components/ui/markdown';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GenerateDialog } from '@/components/ai/GenerateDialog';

type InsightType = 'anomaly' | 'forecast' | 'recommendation' | 'weekly_report';

interface Insight {
  id: string;
  insight_type: InsightType;
  severity: 'low' | 'medium' | 'high' | null;
  period_start: string;
  period_end: string;
  title: string;
  body_md: string;
  meta_json: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  manager: { id: string; full_name: string } | null;
  vacancy: { id: string; title: string } | null;
}

const SEVERITY_BORDER: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-gray-400',
};

const SECTIONS: { type: InsightType; title: string }[] = [
  { type: 'anomaly', title: '🔴 Аномалии' },
  { type: 'forecast', title: '📈 Прогнозы' },
  { type: 'recommendation', title: '💡 Рекомендации по воронке' },
  { type: 'weekly_report', title: '📋 Еженедельные отчёты' },
];

/** ISO-неделя YYYY-Www из даты YYYY-MM-DD. */
function isoWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function AiClient() {
  const [filter, setFilter] = useState<InsightType | 'all'>('all');
  const [insights, setInsights] = useState<Insight[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/insights?type=all&per_page=50');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Ошибка загрузки');
      setInsights(json.data ?? []);
      setUnread(json.meta?.unread ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    try {
      const res = await fetch(`/api/ai/insights/${id}/read`, { method: 'PATCH' });
      if (!res.ok) {
        toast.error('Не удалось отметить прочитанным');
        return;
      }
      setInsights((prev) => prev.map((i) => (i.id === id ? { ...i, is_read: true } : i)));
      setUnread((u) => Math.max(u - 1, 0));
    } catch {
      toast.error('Не удалось отметить прочитанным');
    }
  }

  const visibleSections = SECTIONS.filter((s) => filter === 'all' || s.type === filter);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">AI-инсайты</h1>
          {unread > 0 && (
            <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
              Непрочитанных: {unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as InsightType | 'all')}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="anomaly">Аномалии</SelectItem>
              <SelectItem value="forecast">Прогнозы</SelectItem>
              <SelectItem value="recommendation">Рекомендации</SelectItem>
              <SelectItem value="weekly_report">Отчёты</SelectItem>
            </SelectContent>
          </Select>
          <GenerateDialog onGenerated={load} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : insights.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          AI-анализ ещё не запускался. Нажмите «Обновить анализ».
        </p>
      ) : (
        visibleSections.map((section) => {
          const items = insights.filter((i) => i.insight_type === section.type);
          if (items.length === 0) return null;
          return (
            <section key={section.type} className="grid gap-3">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              {items.map((i) => (
                <InsightCard key={i.id} insight={i} onRead={() => markRead(i.id)} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function InsightCard({ insight, onRead }: { insight: Insight; onRead: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isWeekly = insight.insight_type === 'weekly_report';

  return (
    <Card
      className={cn(
        insight.severity && 'border-l-4',
        insight.severity && SEVERITY_BORDER[insight.severity],
        !insight.is_read && 'ring-1 ring-primary/20',
      )}
    >
      <CardContent className="grid gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">{insight.title}</div>
            <div className="text-muted-foreground text-xs">
              {insight.manager?.full_name ?? insight.vacancy?.title ?? '—'} ·{' '}
              {new Date(insight.created_at).toLocaleDateString('ru-RU')}
              {insight.severity && ` · ${insight.severity}`}
            </div>
          </div>
          {!insight.is_read && (
            <Button variant="ghost" size="sm" onClick={onRead}>
              <Check className="size-4" />
              Прочитано
            </Button>
          )}
        </div>

        {insight.meta_json && (
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
            {Object.entries(insight.meta_json).map(([k, v]) => (
              <span key={k}>
                {k}: {String(v)}
              </span>
            ))}
          </div>
        )}

        {isWeekly ? (
          <Button asChild variant="outline" size="sm" className="w-fit">
            <Link href={`/ai/report/${isoWeek(insight.period_start)}`}>Читать</Link>
          </Button>
        ) : expanded ? (
          <Markdown>{insight.body_md}</Markdown>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setExpanded(true)}
          >
            <ChevronDown className="size-4" />
            Подробнее
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
