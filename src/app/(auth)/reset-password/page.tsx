'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

/**
 * /reset-password — экран смены пароля по recovery-ссылке из письма.
 *
 * SPEC §5.1 описывает URL как `/auth/reset-password`, но в коде используется
 * route group `(auth)/` без префикса в URL — итоговый путь `/reset-password`
 * (так же как `/login` живёт в `(auth)/login/`). При отправке письма через
 * `supabase.auth.resetPasswordForEmail` указываем `redirectTo` именно на
 * `/reset-password`.
 *
 * Активация сессии из URL — два формата (зависит от настроек Supabase):
 *   1. PKCE flow:  ?code=<...>  → exchangeCodeForSession(code) вручную
 *   2. Implicit:   #access_token=...&refresh_token=...&type=recovery
 *      → createBrowserClient с detectSessionInUrl:true (дефолт) подхватит сам
 *
 * После updateUser — domowка по роли (manager → /cabinet, иначе /dashboard),
 * как в /login.
 */

const resetSchema = z
  .object({
    password: z.string().min(8, 'Минимум 8 символов'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Пароли не совпадают',
    path: ['confirm'],
  });
type ResetValues = z.infer<typeof resetSchema>;

type Stage = 'loading' | 'ready' | 'expired';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  });

  useEffect(() => {
    const supabase = createClient();

    async function init() {
      // (1) PKCE: ?code=<...>
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setStage('expired');
          return;
        }
      }

      // (2) Implicit: hash подхватывается createBrowserClient автоматически.
      // Проверяем, что в итоге есть валидная сессия (любым способом).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setStage(session ? 'ready' : 'expired');
    }

    void init();
  }, []);

  async function onSubmit(values: ResetValues) {
    setSubmitting(true);
    const supabase = createClient();

    const { data, error } = await supabase.auth.updateUser({ password: values.password });
    if (error || !data.user) {
      setSubmitting(false);
      const msg = (error?.message ?? '').toLowerCase();
      if (msg.includes('weak') || msg.includes('password')) {
        toast.error('Пароль слишком простой. Попробуйте сложнее.');
      } else if (msg.includes('expired') || msg.includes('invalid')) {
        // Сессия recovery протухла между загрузкой страницы и submit.
        setStage('expired');
        toast.error('Ссылка устарела. Запросите письмо заново.');
      } else {
        toast.error(error?.message ?? 'Не удалось сменить пароль');
      }
      return;
    }

    // Домашняя страница по роли (одинаково с /login).
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();
    const home = profile?.role === 'manager' ? '/cabinet' : '/dashboard';

    toast.success('Пароль обновлён');
    router.replace(home);
    router.refresh();
  }

  if (stage === 'loading') {
    return (
      <Card className="w-full max-w-sm">
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (stage === 'expired') {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Ссылка устарела</CardTitle>
          <CardDescription>
            Запросите письмо для сброса пароля заново.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Вернуться на вход</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Новый пароль</CardTitle>
        <CardDescription>Минимум 8 символов</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Новый пароль</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Подтвердите пароль</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Сменить пароль
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
