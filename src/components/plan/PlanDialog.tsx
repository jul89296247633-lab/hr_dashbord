'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

export interface PlanValues {
  calls_per_day: number;
  interviews_per_day: number;
  hires_per_month: number;
  vacancies_limit: number;
}

const schema = z.object({
  calls_per_day: z.coerce.number().int('Целое').min(0, 'От 0 до 200').max(200, 'От 0 до 200'),
  interviews_per_day: z.coerce.number().int('Целое').min(0, 'От 0 до 50').max(50, 'От 0 до 50'),
  hires_per_month: z.coerce.number().int('Целое').min(0, 'От 0 до 100').max(100, 'От 0 до 100'),
  vacancies_limit: z.coerce.number().int('Целое').min(0, 'От 0 до 100').max(100, 'От 0 до 100'),
  effective_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата: YYYY-MM-DD')
    .or(z.literal(''))
    .optional(),
});
type FormValues = z.infer<typeof schema>;

const NUM_FIELDS: { name: keyof PlanValues; label: string }[] = [
  { name: 'calls_per_day', label: 'Звонков в день' },
  { name: 'interviews_per_day', label: 'Собеседований в день' },
  { name: 'hires_per_month', label: 'Выводов в месяц' },
  { name: 'vacancies_limit', label: 'Лимит вакансий' },
];

export function PlanDialog({
  managerId,
  managerName,
  current,
  onSaved,
}: {
  managerId: string;
  managerName: string;
  current: PlanValues;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...current, effective_from: '' },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        manager_id: managerId,
        calls_per_day: values.calls_per_day,
        interviews_per_day: values.interviews_per_day,
        hires_per_month: values.hires_per_month,
        vacancies_limit: values.vacancies_limit,
      };
      if (values.effective_from) body.effective_from = values.effective_from;

      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения плана');
        return;
      }
      toast.success(json.message ?? 'План обновлён');
      setOpen(false);
      onSaved();
    } catch {
      toast.error('Ошибка сохранения плана');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) form.reset({ ...current, effective_from: '' });
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="size-4" />
          Изменить
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>План: {managerName}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {NUM_FIELDS.map((f) => (
              <FormField
                key={f.name}
                control={form.control}
                name={f.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{f.label}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <FormField
              control={form.control}
              name="effective_from"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Действует с</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    По умолчанию — 1-е число следующего месяца. Старый план остаётся в истории.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
