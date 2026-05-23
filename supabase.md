---
description: Правила работы с Supabase — RLS, клиенты, безопасность
globs: ["app/api/**", "lib/supabase/**", "scripts/**"]
---

# Supabase Rules

## Два клиента — строго разные контексты

```typescript
// 1. Серверный клиент (API routes, Server Components) — уважает RLS
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value } }
  );
}

// 2. Service role (cron-скрипты, синхронизации) — BYPASS RLS
// Только на Beget VPS, никогда не в Next.js frontend
import { createClient as createAdminClient } from '@supabase/supabase-js';
const adminSupabase = createAdminClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ТОЛЬКО сервер
);

// 3. Браузерный клиент (Client Components) — только для auth событий
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

## getUser() — не getSession()

```typescript
// ✅ Правильно — проверяет токен с сервером Supabase
const { data: { user } } = await supabase.auth.getUser();

// ❌ Неправильно — только читает из cookie, не проверяет валидность
const { data: { session } } = await supabase.auth.getSession();
```

## RLS — проверяй что политики созданы

Перед добавлением таблицы убедись:
- `ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;`
- Есть хотя бы одна SELECT политика
- Есть политика для service_role если нужна запись из cron

## Ошибки Supabase — всегда проверяй

```typescript
// ✅ Правильно
const { data, error } = await supabase.from('vacancies').select('*').single();
if (error) throw new ApiError(404, 'NOT_FOUND', 'Вакансия не найдена');

// ❌ Неправильно — игнорирует ошибку
const { data } = await supabase.from('vacancies').select('*').single();
```

## Upsert — всегда с onConflict

```typescript
// ✅ Правильно
await supabase.from('daily_activities').upsert(
  { manager_id, activity_date, hh_calls_count },
  { onConflict: 'manager_id,activity_date' }
);

// ❌ Неправильно — upsert без конфликтного ключа непредсказуем
await supabase.from('daily_activities').upsert({ manager_id, activity_date, hh_calls_count });
```

## Сортировка для "последняя запись"

```typescript
// Активный план (последний по effective_from ≤ сегодня)
.order('effective_from', { ascending: false }).limit(1)

// Последний snapshot
.order('snapshot_at', { ascending: false }).limit(1)

// История записей (новые сверху)
.order('created_at', { ascending: false })
```

## Счётчик для пагинации

```typescript
const { data, count } = await supabase
  .from('table')
  .select('*', { count: 'exact' }) // count: 'exact' обязателен
  .range(from, from + perPage - 1);
```

## Транзакции — через RPC функции

Если нужно атомарно изменить несколько таблиц:
```typescript
// Создай PostgreSQL функцию в миграции
// Вызывай через supabase.rpc('function_name', { params })
```
