---
description: Правила TypeScript, Zod-валидации и общего качества кода
globs: ["**/*.ts", "**/*.tsx"]
---

# TypeScript & Code Quality Rules

## Типизация — строго

- Никаких `any` без крайней необходимости. Использовать `unknown` + type guard
- Все API responses типизированы через интерфейсы в `types/index.ts`
- Все Zod-схемы экспортируются из файлов схем, не inline в routes
- Infer типы из Zod: `type ActivityInput = z.infer<typeof ActivityUpsertSchema>`

## Обработка ошибок — всегда

```typescript
// ✅ Правильно
try {
  const result = await riskyOperation();
  return NextResponse.json({ data: result });
} catch (err) {
  return handleApiError(err, request, userId);
}

// ❌ Неправильно — необработанная ошибка
const result = await riskyOperation(); // может упасть без catch
```

## Null safety

```typescript
// ✅ Правильно
const calls = (mango_calls_count ?? 0) + (hh_calls_count ?? 0);
const name = profile?.full_name ?? 'Неизвестно';

// ❌ Неправильно
const calls = mango_calls_count + hh_calls_count; // может быть null
```

## Zod-валидация — обязательна для всех входящих данных

```typescript
const Schema = z.object({
  activity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат: YYYY-MM-DD'),
  calls_count: z.number().int().min(0).max(999),
});

const result = Schema.safeParse(body);
if (!result.success) {
  return errorResponse(422, 'VALIDATION_ERROR', result.error.issues[0].message);
}
const validated = result.data; // типизировано
```

## Async/await везде, никаких .then() цепочек в production-коде

## Импорты — абсолютные пути через @/

```typescript
// ✅
import { logError } from '@/lib/logger';
import { Button } from '@/components/ui/button';

// ❌
import { logError } from '../../../lib/logger';
```

## Именование

- Компоненты: PascalCase (`DashboardPage`, `ManagerTable`)
- Функции/переменные: camelCase (`getAuthUser`, `totalCalls`)
- Константы: UPPER_SNAKE_CASE (`ANOMALY_RULES`, `MAX_RETRIES`)
- Файлы компонентов: PascalCase.tsx
- Файлы утилит/API: kebab-case.ts
- Таблицы БД: snake_case

## Environment variables

- Клиентские (браузер): только `NEXT_PUBLIC_` префикс
- Серверные: без префикса, никогда не передавать в клиент
- `SUPABASE_SERVICE_ROLE_KEY` — ТОЛЬКО в серверном коде и cron-скриптах
- `ANTHROPIC_API_KEY` — ТОЛЬКО в серверном коде

## console.log в production — запрещён

Используй только:
```typescript
console.error('[sync-hh] Error:', err.message); // для cron (stdout → pm2 logs)
// Для приложения — logError() в error_logs таблицу
```
