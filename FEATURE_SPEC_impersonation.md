# FEATURE SPEC — Impersonation («Вход как менеджер»)

> Статус: **спека на ревью** (код не начат). Сессия 2026-05-30.
> Связано: [HANDOFF.md](HANDOFF.md) (Незакрытый функционал), [CLAUDE.md](CLAUDE.md) (роли, RLS).

## Контекст и цель

admin/head нужно видеть систему глазами конкретного менеджера — для разбора проблем,
отладки KPI/бонусов, проверки прав. Без impersonation приходится верить на слово или
лезть в БД. Цель: безопасный, аудируемый, обратимый режим «войти как менеджер».

## Зафиксированные решения

| Вопрос | Решение |
|---|---|
| Кто может | **admin + head** |
| Механика | **Overlay + read-only** (сессия admin сохраняется; мутации заблокированы) |
| Индикация/аудит | **Постоянный баннер** + **отдельная таблица `impersonation_logs`** |
| Цель impersonation | **только `role='manager'`** (никогда head/admin/executive) |
| Срок сессии | **1 час**, server-authoritative (см. §6) |

## Почему Overlay (а не session swap)

Идентичность в проекте централизована в `getAuthUser()` ([api-helpers.ts:39](src/lib/api-helpers.ts#L39)):
`auth.uid()` → `user_profiles` → `{ id, role, full_name }`. Все роуты берут identity отсюда и
считают `effectiveManagerId = user.id`. Поэтому достаточно сделать `getAuthUser` overlay-aware —
и весь app «становится» менеджером, без подмены реальной Supabase-сессии. Реальная сессия
остаётся admin → impersonator всегда известен (идеально для аудита), возврат тривиален
(удалить cookie), RLS-риск записи снимается read-only режимом.

---

## 1. БД — миграция `impersonation_logs`

`impersonation_logs` — одновременно **аудит** И **server-authoritative запись активной сессии**
(источник истины для overlay и expiry; cookie лишь указывает на её `id`).

```sql
CREATE TABLE public.impersonation_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonator_id   uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  impersonator_role text NOT NULL,                 -- 'admin' | 'head' на момент старта
  target_manager_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,                    -- NULL = активна; заполняется при stop/expiry
  end_reason        text,                           -- 'manual' | 'expired' | NULL(активна)
  ip_address        text,
  user_agent        text
);

-- Активная сессия impersonator'а (для overlay-lookup и stop) + история.
CREATE INDEX idx_impersonation_logs_active
  ON public.impersonation_logs (impersonator_id) WHERE ended_at IS NULL;
CREATE INDEX idx_impersonation_logs_history
  ON public.impersonation_logs (impersonator_id, started_at DESC);

-- RLS: SELECT — только admin (как audit_logs); запись — service_role (createAdminClient).
ALTER TABLE public.impersonation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY impersonation_logs_admin_select ON public.impersonation_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles u
            WHERE u.id = auth.uid() AND u.role = 'admin')
  );
```

- Запись (start/stop/expiry) — через `createAdminClient()` (service_role, обход RLS).
- `+ types/database.ts`: добавить `impersonation_logs` (Row/Insert/Update/FK).
- Применение — `supabase migration new` → показать → `db push` (как SEC-001/007).

## 2. Auth-ядро — [api-helpers.ts](src/lib/api-helpers.ts)

```ts
const IMPERSONATE_COOKIE = 'impersonate_sid';  // = impersonation_logs.id (uuid)
const IMPERSONATE_TTL_MS = 60 * 60 * 1000;     // 1 час

interface AuthContext {
  user: AuthUser;        // эффективная identity (менеджер при impersonation)
  realUser: AuthUser;    // всегда реальный вошедший (admin/head)
  impersonating: boolean;
}

// Новый источник истины. getAuthUser() = (await getAuthContext()).user — overlay-aware,
// обратносовместимо: существующие роуты не меняются.
export async function getAuthContext(): Promise<AuthContext> {
  const realUser = /* текущая логика getAuthUser: getUser() + профиль + is_active */;
  const sid = (await cookies()).get(IMPERSONATE_COOKIE)?.value;
  if (!sid || (realUser.role !== 'admin' && realUser.role !== 'head')) {
    return { user: realUser, realUser, impersonating: false };
  }

  // SERVER-AUTHORITATIVE: overlay активен ТОЛЬКО если есть валидная незакрытая
  // непросроченная запись сессии в БД (а не «потому что cookie существует»).
  const db = createAdminClient();
  const { data: sess } = await db
    .from('impersonation_logs')
    .select('id, impersonator_id, target_manager_id, started_at, ended_at')
    .eq('id', sid)
    .maybeSingle();

  const valid =
    sess &&
    sess.impersonator_id === realUser.id &&            // cookie привязан к этому admin
    sess.ended_at === null &&                          // не остановлена (stop авторитетен)
    Date.now() - new Date(sess.started_at).getTime() < IMPERSONATE_TTL_MS; // не просрочена

  if (valid) {
    const target = /* user_profiles where id = sess.target_manager_id */;
    if (target && target.role === 'manager' && target.is_active) {
      return { user: targetAsAuthUser, realUser, impersonating: true };
    }
  }
  return { user: realUser, realUser, impersonating: false };
}
```

**Два независимых гейта:** (1) реальная роль admin/head; (2) валидная активная запись в БД.
Cookie сам по себе прав не даёт — только указывает на `id` сессии, которую проверяет сервер.

## 3. Endpoints

**`POST /api/admin/impersonate`** `{ manager_id }`
- `getAuthContext().realUser` → `requireRole(['admin','head'])`.
- Валидация: `manager_id` UUID; target существует; `role='manager'`; `is_active`.
- **Оптоочистка** брошенных сессий этого admin: `UPDATE impersonation_logs SET ended_at=now(), end_reason='expired' WHERE impersonator_id=real AND ended_at IS NULL` (одна активная сессия на admin).
- INSERT новой строки → получить `id`.
- Set httpOnly-cookie `impersonate_sid = id` (secure, sameSite lax, path `/`, **maxAge 3600**).
- 200 `{ ok: true }`.

**`POST /api/admin/impersonate/stop`**
- `getAuthContext().realUser`.
- `UPDATE impersonation_logs SET ended_at=now(), end_reason='manual' WHERE impersonator_id=real AND ended_at IS NULL`.
- Очистить cookie. 200. (После UPDATE overlay прекращается server-side немедленно.)

## 4. Read-only enforcement — [middleware.ts](src/lib/supabase/middleware.ts)

**Проверено:** в проекте **нет Server Actions** (`'use server'` — 0 совпадений). Все мутации идут
через `/api/*` route handlers. Тем не менее guard сделан **future-proof** — ловит и Server Actions
(POST на страницу с заголовком `Next-Action`), если их добавят позже.

В `updateSession`:
```
const isMutatingApi = path.startsWith('/api')
                      && method ∈ {POST, PATCH, PUT, DELETE};
const isServerAction = request.headers.has('next-action'); // вызов Server Action
const isControl = path === '/api/admin/impersonate'
                  || path === '/api/admin/impersonate/stop';

если cookie impersonate_sid присутствует
   и (isMutatingApi || isServerAction)
   и НЕ isControl
→ 403 JSON { error: { code: 'IMPERSONATION_READONLY',
                      message: 'Действие недоступно в режиме просмотра (impersonation)' } }
```
**Fail-closed:** даже подделанная cookie лишь блокирует записи, прав не даёт. Контрольные
endpoints (start/stop) в allowlist. Покрытие: REST `/api/*` (сегодня — все записи) + Server Actions
(на будущее) → дыры для записи нет.

> Defense-in-depth (опционально): экспортировать `assertWritable(ctx)` и вызывать в мутирующих
> роутах — на случай, если кто-то обойдёт middleware. Не обязательно, т.к. middleware покрывает всё.

## 5. Баннер + UI

- **Баннер** (в `(app)` server-layout через `getAuthContext`): постоянный, заметный (amber/destructive),
  «⚠ Вы вошли как **{ФИО}** (режим просмотра) · [Выйти из режима]». Кнопка (client) → `POST /stop` → reload.
- **Триггер «Войти как»**: admin → строки `/admin/users`; head → team-таблица дашборда.
  Только для строк с `role='manager'`.

## 6. Срок сессии и завершение (expiry)

**TTL = 1 час.** Три механизма завершения, admin не зависает в чужом кабинете:

| Способ | Механизм |
|---|---|
| **Ручной выход** | Кнопка в баннере → `/stop` → `ended_at=now(), end_reason='manual'`; overlay прекращается немедленно (server-authoritative). |
| **Истечение (server)** | `getAuthContext` проверяет `started_at + 1ч > now()`. Просроченная сессия → overlay НЕ активируется, даже если cookie ещё жив (защита от replay скопированного cookie). |
| **Истечение (client)** | cookie `maxAge=3600` — браузер сам удаляет через час. |
| **Брошенные строки** | При следующем `/start` этого admin его незакрытые строки закрываются `end_reason='expired'` (оптоочистка, как у OAuth-nonce). |

Итог: overlay живёт максимум 1 час; авторитет завершения — БД (`ended_at` / `started_at+TTL`), не cookie.

## 7. Security-инварианты (threat model)

1. **Эскалация привилегий** — закрыта: гейт = реальная роль (admin/head), перепроверяется каждым запросом.
2. **Upward/lateral impersonation** — закрыта: target обязан быть `role='manager'`.
3. **Запись от чужого имени** — закрыта: read-only (middleware блокирует мутации `/api/*` + Server Actions).
4. **Аудит** — `impersonation_logs` start/stop/expiry с impersonator_id + target + ip/ua; SELECT admin-only.
5. **Обратимость** — `/stop` (или удалить cookie); реальная сессия не тронута.
6. **Tamper / replay** — cookie httpOnly (нет JS); fail-closed на мутациях; overlay-гейт по реальной
   роли + валидной незакрытой непросроченной записи в БД (cookie сам прав не даёт).
7. **Auto-expiry** — 1 час, server-authoritative (см. §6).

## 8. Файлы

| Файл | Изменение |
|---|---|
| `supabase/migrations/<ts>_impersonation_logs.sql` | новая таблица + RLS + индексы |
| `src/types/database.ts` | + `impersonation_logs` |
| `src/lib/api-helpers.ts` | `getAuthContext()`, overlay в `getAuthUser`, `IMPERSONATE_COOKIE`, TTL |
| `src/lib/supabase/middleware.ts` | read-only guard (`/api/*` + Server Actions); (опц.) home-redirect как менеджер |
| `src/app/api/admin/impersonate/route.ts` | POST start |
| `src/app/api/admin/impersonate/stop/route.ts` | POST stop |
| `src/components/layout/ImpersonationBanner.tsx` | баннер (+ интеграция в `(app)` layout) |
| `src/components/admin/UsersClient.tsx` (+ team-таблица) | кнопка «Войти как» |

## 9. Verification (план проверки)

1. admin → «Войти как» менеджер → видит `/cabinet`, `/bonuses` как менеджер; баннер виден.
2. Любая мутация (POST/PATCH/DELETE) в режиме → **403** `IMPERSONATION_READONLY`.
3. «Выйти из режима» → снова admin; баннера нет; `ended_at` заполнен `end_reason='manual'`.
4. **Expiry:** подменить `started_at` записи на >1ч назад → overlay не активируется (realUser).
5. **Негатив:** manager с подставной cookie → overlay НЕ активируется (реальная роль manager).
6. **Негатив:** impersonate head/admin → 422/403 (target не manager).
7. head → impersonate manager работает; head → impersonate head/admin запрещён.
8. (future-proof) при наличии Server Action — POST с `Next-Action` в режиме → 403.
9. `tsc` 0, `npm run lint` 0.

## 10. Вне scope (будущее)

- **Полный act-as (запись)** — отдельным слоем: мутации через admin-client с явным
  manager_id + аудит каждого действия. Сейчас read-only.
- View логов impersonation в UI (`/admin/logs` вкладка). Пока — только таблица + SQL.
- Ограничение «head не может impersonate менеджеров чужого подразделения» (если появится оргструктура).

---

## Порядок реализации (после апрува спеки)

1. Миграция `impersonation_logs` (`migration new` → показать → `db push`) + типы.
2. Auth-ядро: `getAuthContext` + overlay в `getAuthUser`.
3. Endpoints start/stop.
4. Read-only guard в middleware (`/api/*` + `Next-Action`).
5. Баннер + кнопка «Войти как».
6. Verification + коммиты по этапам.
