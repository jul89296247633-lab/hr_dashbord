'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STATUSES = [
  { value: 'active', label: 'Активна' },
  { value: 'paused', label: 'На паузе' },
  { value: 'draft', label: 'Черновик' },
  { value: 'closed', label: 'Закрыта' },
] as const;

const formSchema = z.object({
  title: z.string().min(2, 'Минимум 2 символа').max(200, 'Максимум 200 символов'),
  department: z.string().max(100).optional(),
  subdivision: z.string().max(100).optional(),
  manager_id: z.string().uuid('Выберите ответственного менеджера'),
  hh_vacancy_id: z
    .string()
    .regex(/^\d+$/, 'Только цифры')
    .or(z.literal(''))
    .optional(),
  opened_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата: YYYY-MM-DD'),
  status: z.enum(['active', 'paused', 'closed', 'draft']),
});
type FormValues = z.infer<typeof formSchema>;

export interface VacancyFormProps {
  mode: 'create' | 'edit';
  managers: { id: string; full_name: string }[];
  vacancyId?: string;
  initial?: Partial<FormValues>;
}

export function VacancyForm({ mode, managers, vacancyId, initial }: VacancyFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: initial?.title ?? '',
      department: initial?.department ?? '',
      subdivision: initial?.subdivision ?? '',
      manager_id: initial?.manager_id ?? '',
      hh_vacancy_id: initial?.hh_vacancy_id ?? '',
      opened_at: initial?.opened_at ?? new Date().toISOString().slice(0, 10),
      status: initial?.status ?? 'active',
    },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const body = {
        title: values.title,
        department: values.department?.trim() || null,
        subdivision: values.subdivision?.trim() || null,
        manager_id: values.manager_id,
        hh_vacancy_id: values.hh_vacancy_id?.trim() || null,
        opened_at: values.opened_at,
        status: values.status,
      };

      const url = mode === 'create' ? '/api/vacancies' : `/api/vacancies/${vacancyId}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Ошибка сохранения вакансии');
        return;
      }
      toast.success(json.message ?? 'Вакансия сохранена');
      const id = mode === 'create' ? json.data.id : vacancyId;
      router.push(`/vacancies/${id}`);
      router.refresh();
    } catch {
      toast.error('Ошибка сохранения вакансии');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <h1 className="text-2xl font-semibold">
        {mode === 'create' ? 'Новая вакансия' : 'Редактирование вакансии'}
      </h1>
      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Название вакансии</FormLabel>
                    <FormControl>
                      <Input placeholder="Менеджер по продажам (Москва)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Отдел</FormLabel>
                    <FormControl>
                      <Input placeholder="Отдел продаж" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="subdivision"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Подразделение</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="manager_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ответственный менеджер</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите менеджера" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {managers.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hh_vacancy_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ID вакансии на HH.ru</FormLabel>
                    <FormControl>
                      <Input placeholder="98765432" {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>Числовой ID из URL: hh.ru/vacancy/&#123;id&#125;</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="opened_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Дата открытия</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Статус</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Сохранить
                </Button>
                <Button type="button" variant="outline" asChild>
                  <Link href="/vacancies">Отмена</Link>
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
