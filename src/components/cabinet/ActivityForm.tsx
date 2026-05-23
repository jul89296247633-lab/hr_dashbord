'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save, Loader2, PencilLine, Users, FileCheck, Globe } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { CabinetActivity } from '@/components/cabinet/types';

const countField = z.coerce.number().int('Целое число').min(0, 'От 0 до 999').max(999, 'От 0 до 999');

const formSchema = z.object({
  hh_calls_count: countField.optional(),
  interviews_count: countField,
  offers_count: countField,
  notes: z.string().max(1000, 'Максимум 1000 символов').optional(),
});
type FormValues = z.infer<typeof formSchema>;

const REQUEST_TIMEOUT_MS = 10_000;

export function ActivityForm({
  date,
  editable,
  hhActive,
  activity,
  onSaved,
}: {
  date: string;
  editable: boolean;
  hhActive: boolean;
  activity: CabinetActivity;
  onSaved: (next: CabinetActivity) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const draftKey = `cabinet-draft-${date}`;

  // HH-поле редактируемо, только если источник не автоматический (hh_csv из выгрузки).
  const hhEditable = editable && hhActive && activity.hh_calls_source !== 'hh_csv';
  const hhManual = activity.hh_calls_source === 'manual';

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      hh_calls_count: activity.hh_calls_count ?? undefined,
      interviews_count: activity.interviews_count,
      offers_count: activity.offers_count,
      notes: activity.notes ?? '',
    },
  });

  // Черновик (EC-10): восстановление при монтировании + автосохранение при изменениях.
  useEffect(() => {
    if (!editable || typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(draftKey);
    if (raw) {
      try {
        form.reset({ ...form.getValues(), ...(JSON.parse(raw) as Partial<FormValues>) });
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }
    const sub = form.watch((values) => {
      window.localStorage.setItem(draftKey, JSON.stringify(values));
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, editable]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        activity_date: date,
        interviews_count: values.interviews_count,
        offers_count: values.offers_count,
        notes: values.notes?.trim() ? values.notes : null,
      };
      if (hhEditable && values.hh_calls_count !== undefined) {
        body.hh_calls_count = values.hh_calls_count;
      }

      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения. Попробуйте ещё раз');
        return;
      }

      const saved = json.data as CabinetActivity & { mango_calls_count: number | null };
      onSaved({
        mango_calls_count: saved.mango_calls_count,
        mango_calls_source: saved.mango_calls_source,
        hh_calls_count: saved.hh_calls_count,
        hh_calls_source: saved.hh_calls_source,
        interviews_count: saved.interviews_count,
        offers_count: saved.offers_count,
        notes: saved.notes,
        total_calls: saved.total_calls,
        exists: true,
      });
      window.localStorage.removeItem(draftKey);
      toast.success(json.message ?? 'Данные сохранены');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        toast.error('Превышено время ожидания. Черновик сохранён локально.');
      } else {
        toast.error('Ошибка сохранения. Попробуйте ещё раз');
      }
    } finally {
      clearTimeout(timer);
      setSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
        {hhActive && (
          <FormField
            control={form.control}
            name="hh_calls_count"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Globe className="size-4" />
                  Звонки HH.ru
                  {hhManual && <PencilLine className="text-muted-foreground size-3.5" />}
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={999}
                    disabled={!hhEditable}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>
                  {activity.hh_calls_source === 'hh_csv'
                    ? 'Автоматически из выгрузки HH — изменение недоступно.'
                    : 'Скорректируйте вручную, если данные из HH не получены.'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="interviews_count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Users className="size-4" />
                Собеседования
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={999}
                  disabled={!editable}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                />
              </FormControl>
              <FormDescription>Введите вручную — сколько было сегодня.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="offers_count"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <FileCheck className="size-4" />
                Офферы
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={999}
                  disabled={!editable}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Заметки</FormLabel>
              <FormControl>
                <Textarea
                  rows={4}
                  disabled={!editable}
                  placeholder="Что важного произошло сегодня?"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {editable && (
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Сохранить
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
