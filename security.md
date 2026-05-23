---
description: Правила безопасности — авторизация, секреты, защита данных
globs: ["app/api/**", "lib/**", "middleware.ts", "scripts/**"]
---

# Security Rules

## Авторизация — в каждом API route

```typescript
// Обязательно в начале каждого защищённого route
const { userId, role, fullName } = await getAuthUser();

// Роль проверяй явно
requireRole(role, ['head', 'admin']); // только эти роли

// ❌ НИКОГДА не доверяй роли из тела запроса
const { role } = await request.json(); // ← УЯЗВИМОСТЬ
```

## Секреты — только env, никогда в коде

```typescript
// ✅
process.env.ANTHROPIC_API_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY
process.env.MANGO_API_KEY

// ❌ НИКОГДА
const API_KEY = 'sk-ant-api03-...'; // хардкод в коде
```

## NEXT_PUBLIC_ — только публичные данные

```
NEXT_PUBLIC_SUPABASE_URL=...       ✅ можно в браузер
NEXT_PUBLIC_SUPABASE_ANON_KEY=... ✅ можно в браузер
SUPABASE_SERVICE_ROLE_KEY=...     ❌ НИКОГДА не NEXT_PUBLIC_
ANTHROPIC_API_KEY=...             ❌ НИКОГДА не NEXT_PUBLIC_
MANGO_API_KEY=...                 ❌ НИКОГДА не NEXT_PUBLIC_
```

## Executive роль — скрывать имена менеджеров

```typescript
// В /api/dashboard/team
if (role === 'executive') {
  result.managers = null; // убрать персональные данные
}
// RLS на user_profiles тоже не даёт executive читать профили напрямую
```

## 152-ФЗ — персональные данные

- `hired_employees` содержит данные сотрудников → RLS ограничивает head/admin/executive
- `user_profiles` — только свой профиль для manager
- Не логируй ФИО в error_logs и sync_logs

## Валидация UUID — перед запросом к БД

```typescript
const isValidUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

if (!isValidUUID(params.id)) {
  return errorResponse(422, 'INVALID_ID', 'Некорректный формат ID');
}
```

## CORS — только свой домен

Настроен в `next.config.ts`. Не расширяй без явной необходимости.

## Rate limiting — для AI эндпоинтов

```typescript
// POST /api/ai/insights/generate — не более 1 раза в 2 часа
// Проверяй ai_insights WHERE triggered_by = userId AND created_at > now()-2h
```

## Cron-скрипты — только SUPABASE_SERVICE_ROLE_KEY

Service role ключ должен быть только:
- В `.env` на Beget VPS
- В коде `scripts/*.ts`
Никогда в Next.js приложении (Vercel).

## Audit trail — автоматически

Триггеры `audit_trigger_fn()` уже установлены на ключевых таблицах.
Не добавляй ручную запись в `audit_logs` — будет дублирование.
