# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-06-03 (prod-блокеры перед PR в main: SEC-012 + CSP закрыты, RLS-тесты — план готов)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🚧 Prod-блокеры перед PR `feature/bonuses-admin-vacancies` → `main` (сессия 2026-06-03)

Решения по веткам: **3 ветки по блокеру от feature** (не от main — main отстаёт, нет FS-2/схемы), каждая `--no-ff` мёрджится обратно в feature; финал — один PR feature → main.

| # | Блокер | Статус | Где |
|---|--------|--------|-----|
| 2 | **SEC-012 `xlsx`** | ✅ **Закрыт** | `chore/sec-012-xlsx` → merge `62ae9f7` |
| 3 | **CSP enforced** | ✅ **Код готов**, ждёт рантайм-верификации | `chore/csp-enforce` → merge `eafed9d` |
| 1 | **RLS-тесты под Docker** | 🔧 **Каркас написан**, отладка на стенде у пользователя | `chore/rls-integration-tests` |

**SEC-012** (`62ae9f7`): `xlsx 0.18.5 → 0.20.3` с официального CDN SheetJS (`package.json` указывает на tgz-URL) — патч **CVE-2023-30533** (prototype pollution, фикс 0.19.3) + **CVE-2024-22363** (ReDoS, фикс 0.20.2). API не менялся (`read`/`sheet_to_json`/`write`/`aoa_to_sheet` в [xlsx-parser.ts](src/lib/templates/xlsx-parser.ts)) → код не тронут. Лимит 10 МБ + `.xlsx`-валидация уже в [upload route](src/app/api/templates/upload/route.ts). Проверено: round-trip 0.20.3 (кириллица), tsc/lint/тесты 117/117/`next build` зелёные. Остаток `npm audit` — 2 moderate по `postcss` (транзитив Next, **не** SEC-012, не трогаем).

**CSP** (`eafed9d`): флип в [next.config.ts](next.config.ts) `Content-Security-Policy-Report-Only` → `Content-Security-Policy`, **директивы не менялись** (`script/style` `unsafe-inline`+`unsafe-eval` для Next hydration — ужесточение на nonce = отдельная задача). Проверено по коду: все внешние вызовы (HH/Mango/Anthropic/Google) — **серверные**, клиентские `fetch` бьют только в свой `/api` (self) + Supabase REST/WS → `connect-src 'self' https://*.supabase.co wss://*.supabase.co` достаточно, доменов добавлять не нужно. **Не закрыто:** рантайм-верификация CSP-violation на **Vercel preview** ветки feature (DevTools Console/Network): `/login`, `/dashboard`, `/vacancies/admin`, `/staffing/plan`, `/bonuses`, `/admin/bonuses`, `/onboarding`. Локально не проверяемо (middleware падает без env; dummy-ключи дают ложный результат — осознанно не делали).

**RLS-тесты** (ветка `chore/rls-integration-tests`, от feature): план — [docs/RLS_TEST_PLAN.md](docs/RLS_TEST_PLAN.md). Docker появился у пользователя; идёт отладка каркаса на поднятом стенде (`supabase start` → `npm run test:integration`).
- **Каркас** — [rls-isolation.test.ts](src/tests/integration/rls-isolation.test.ts): первый тест (Группа 1, изоляция `hr_bonuses`: manager1 не видит бонусы manager2). Подход — raw SQL через `pg` (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), `BEGIN→seed под postgres→actAs→SELECT→assert→ROLLBACK`, graceful-skip без стенда. +`pg`/`@types/pg` (devDeps). Закоммичено: каркас + get_my_role-репейр (HEAD `54cb6da`).
- **Drift, вскрытый `supabase start`** (прод собран вне цепочки миграций):
  1. **`get_my_role()`** не создавалась ни одной миграцией → harden@062400 падал на `ALTER` её. Репейр [20260530050000_create_get_my_role.sql](supabase/migrations/20260530050000_create_get_my_role.sql) (закоммичен `54cb6da`).
  2. **Политики `user_profiles` рекурсивны** в `initial_schema` (`EXISTS(SELECT FROM user_profiles)` внутри политики самой таблицы → infinite recursion); прод использует `get_my_role()`. Репейр [20260530050100_repair_user_profiles_policies.sql](supabase/migrations/20260530050100_repair_user_profiles_policies.sql) — пересоздаёт 3 боевые политики (**ещё не закоммичен**, идёт прогон).
  3. Сидинг каркаса доведён под локальную схему: `user_profiles.email` NOT NULL (добавлен), upsert `ON CONFLICT (id)` под триггер `handle_new_user` (создаёт профиль с дефолтной ролью) — **не закоммичено**.
- Обе репейр-миграции идемпотентны и безопасны для прода (no-op при `db push` — идентичны боевым). Политики ДРУГИХ таблиц (`EXISTS FROM user_profiles`) — норма, не рекурсия, совпадают с продом, не трогаем.
- **Далее:** дожать зелёный каркас → закоммитить репейры+сидинг → масштабировать на Группы 1/2/4; Группа 5 — расширение `rls-trigger.test.ts`; Группа 3 покрыта `executive-pii.test.ts`.

**Git:** SEC-012/CSP в feature (HEAD `e18e061`, local==origin). RLS — отдельная ветка `chore/rls-integration-tests` (НЕ влита в feature до зелёного прогона). В `main` НЕ влита.

### Осталось до PR в main
1. RLS-тесты — дожать каркас на стенде, закоммитить репейры+сидинг, смёржить в feature.
2. CSP — рантайм-верификация (решено: на **production после merge**, preview не нашёлся; в тело PR — как post-merge проверка).
3. После RLS-зелёного → PR `feature → main`.

---

## ✅ FS-2 «Бонусы + админ-таблица вакансий (стиль Data)» — РЕАЛИЗОВАНО и в проде (сессия 2026-06-02)

Спека #3: [FEATURE_SPEC_3_vacancies_data_view.md](docs/FEATURE_SPEC_3_vacancies_data_view.md). Сводный коммит ветки `cd9b026` (включает реализацию #3 + фиксы cross-model review бонусов).

**Новое в БД** (применено `supabase db push`):
- `20260531130000_vacancies_data_fields` — enum `appearance_reason` (`dismissal/replacement/expansion/internal_transfer/other`) + поля `appearance_reason`, `explanation`, `candidate_name`, `comment` + CHECK-лимиты длины; `department` **депрецирован** (COMMENT, не дропнут — канон = `subdivision`, данные пусты на 100%);
- `20260531140000_bonus_skip_draft_close` — `CREATE OR REPLACE auto_create_bonus_on_close` с guard `IF OLD.status='draft' THEN RETURN NEW` (не начислять бонус при закрытии черновика; ACL не сброшен — без DROP).

**Extra-поля #3 (зафиксировано):** каноническое подразделение — **`subdivision`** (`department` мёртв, 0/200, не пишется нигде: убран из `POST /api/vacancies`, `requests`, наследования сиблингов в `activate`, и из `VacancyForm` — был баг записи в мёртвое поле); `days_to_close` — GENERATED (TTF); `priority` — text (`высокий/средний/низкий`); причина появления = enum, пояснение = свободный text (независимы от `request_reason`).

**Код:** `/vacancies/admin` переверстан под вид Data — 16 колонок в порядке Sheets (Название/Город/Формат поиска/Причина/Пояснение/Подразделение/Заказчик/Приоритет/Кол-во/даты/Статус/Менеджер/TTF/Кандидат/Комментарий) + хвостовые операционные (Штатка #2 / HH ID / Ref); цвет строки по `status` (`STATUS_ROW_VARIANTS` на `TableRow`), цветной приоритет, RU-маппинг причины, TTF (закрытая=`days_to_close`, открытая=«N в работе»), пустой priority → «—» (EC-1); inline-edit статуса (`VacancyStatusCell`) и ячеек сохранён; фильтр + поле подразделения. **Фиксы cross-model review (P1):** executive не получает имён менеджеров в `GET /api/bonuses/summary` и `GET /api/vacancies/requests` (EC-09); `total_amount_kopecks` в `/api/bonuses` считается по всей выборке фильтра (не по странице).

**Верификация на живых данных (прод):** advisor — без нового регресса (SEC-001 цел, `compute_staffing_plan` не anon; миграции аддитивные/`CREATE OR REPLACE` → ACL не сброшен); схема — все 4 поля + CHECK на месте; `department` default NULL; триггер: `active→closed` = бонус создаётся, **`draft→closed` = 0 бонусов**, NULL manager_id guard намеренный (0/200); snapshot тарифа фиксируется в `hr_bonuses` (изменение `bonus_rates` старые не пересчитывает); все тест-строки в транзакциях с ROLLBACK (0 остаточных). **tsc 0, lint 0 warning, тесты 117/117** (+ новый `executive-pii.test.ts` на EC-09).

**Git:** ветка `feature/bonuses-admin-vacancies`, коммит `cd9b026` (21 файл), запушен в origin (local==origin). **В `main` НЕ влита** (PR — после prod-блокеров).

### Открытые на следующие сессии
- **Build не нужен** — FS-2 в проде.
- **Backfill ~158 вакансий** к штатке (#2) — по необходимости, ручной привязкой.
- **Prod-блокеры до merge в main** — см. секцию выше (SEC-012 ✅, CSP код готов/ждёт preview, RLS план готов/ждёт Docker).
- Возможные доработки из review (не блокеры): `bonus_date` не обновляется при повторном закрытии (P2); доступ `GET /api/admin/bonus-rates` для head (зафиксировать).

---

## ✅ Build спеки #2 «Авто-укомплектованность» — РЕАЛИЗОВАНО и в проде (сессия 2026-05-31)

Спека: [FEATURE_SPEC_auto_staffing.md](FEATURE_SPEC_auto_staffing.md). Укомплектованность считается **из статусов привязанных вакансий**, ручной ввод «Занято» депрецирован.

**Новое в БД** (миграция `20260531062025_auto_staffing`, применена `supabase db push`):
- `vacancies.staffing_plan_id` (FK → `staffing_plan`, **ON DELETE SET NULL**) + partial-индекс; **backfill 6** точных (city+position) совпадений;
- новый `compute_staffing_plan`: `holes = COUNT(привязанные WHERE status NOT IN ('closed','draft'))`, `occupied = GREATEST(planned_units − holes, 0)`, `vacant = holes`; **без `in_progress`**; матчинг по `staffing_plan_id` (не fuzzy); сигнатура `(text, double precision)` сохранена;
- **SEC-001 восстановлен после DROP** — `REVOKE EXECUTE FROM PUBLIC, anon` + `GRANT TO authenticated` (без этого DROP сбрасывает ACL на дефолтный PUBLIC → регресс);
- `occupied_units` **депрецирован, НЕ дропнут** (legacy, RPC её не читает).

**Код:** `GET /api/staffing/positions` (города/должности штатки для формы); `POST /api/vacancies/requests` принимает `staffing_plan_id`, title/location берёт из строки штатки; `activate` — сиблинги мульти-позиции наследуют `staffing_plan_id`; `PATCH /api/vacancies/[id]` + admin-select — ручная привязка/отвязка; `plan`/`availability` без `in_progress`; `occupied_units` больше не пишется (`POST plan`, `diff-builder`, templates `apply` — «Занято» в импорте парсится, но в БД не идёт). UI: `VacancyRequestForm` (режим «из штатки»: город→должность→привязка / «нет в штатке»), `AdminVacanciesClient` (колонка «Штатка» + popover привязки), `StaffingPlanTable`/`CheckWidget`/`RowForm` (убраны `in_progress` и поле «Занято»).

**Семантика (зафиксировано):** занято = **только `closed`** (реальный найм); любой другой активированный статус (`active`/`probation`/`paused`/`cancelled`) = **дыра** (место пустое); `draft` исключён (заявка/отклонённая — не дыра). Укомплектованность **общая** (без деления розница/компания).

**Верификация на живых данных (прод):** advisor — `compute_staffing_plan` **не** anon-executable (SEC-001 цел, ACL `postgres/authenticated/service_role`), новых WARN нет; backfill = 6; формула на 6 сценариях — active=дыра (occupied=planned−1), closed→occupied растёт, **cancelled остаётся дырой (не завышает)**, GREATEST не уходит в минус, draft исключён; тестовые строки в транзакции с ROLLBACK (0 остаточных); tsc/lint 0; тест `AdminVacanciesClient` 19/19 (обновлён под второй mount-fetch `/api/staffing/plan`).

**Git:** ветка `feature/bonuses-admin-vacancies`, коммит `73eb94f` (19 файлов), запушен в origin (local==origin). **В `main` НЕ влита** (PR — после prod-блокеров).

### Открытые на следующие сессии
- **Build не нужен** — фича готова и в проде.
- **Backfill остальных ~158 вакансий** — по необходимости, ручной привязкой в `/vacancies/admin` (fuzzy осознанно не применяем).
- **Спека #3** (Excel-импорт вакансий) — если понадобится; отдельный FEATURE_SPEC.
- **Prod-блокеры до merge в main** — см. ниже (SEC-012 `xlsx`, RLS-интеграционные тесты под Docker, CSP report-only → enforced).

---

## ✅ Build спеки #1 «Ввод вакансий» — РЕАЛИЗОВАНО и применено (сессия 2026-05-31)

Не только спека — **рабочий код, применён в проде**. Спека: [FEATURE_SPEC_vacancy_entry.md](FEATURE_SPEC_vacancy_entry.md).

**Новое в БД** (миграции `20260530165725_vacancy_entry` + `20260531035559_vacancy_entry_revoke_trigger_grants`, применены):
- `vacancies.status` +`probation` (Стажировка) +`cancelled` (Отмена ≠ paused);
- `vacancies.position_group_id` / `queue_index` — группа позиций для эстафеты дат;
- `hired_employees` +`source` ('sheets'/'app'), `sheet_row_id` nullable, дедуп app по `(vacancy_id, status)`;
- триггер `auto_hired_employee_on_status` (closed→employee/hired, probation→intern/probation; `cancelled` исключён);
- триггер `relay_position_group_open_date` (эстафета: закрытие i-й → `opened_at` следующей active = `closed_at`; cancelled не источник/не цель);
- `REVOKE EXECUTE` у обеих триггер-функций (FROM public/anon/authenticated, паттерн SEC-003).

**Код:** форма заявки (+customer_name/positions_count/priority + datalist-автодополнение), `activate` создаёт N строк-вакансий группой при positions_count>1 (service_role, EC-13 hh_id только у первой), PATCH вакансии (probation/cancelled, closed_at=today), новый `GET /api/vacancies/requests/options`, статусы Стажировка/Отмена в AdminVacanciesClient, подсказка «N позиций».

**Верификация на живых данных (прод):** эстафета 3 позиций (01.03→10.03→20.03) ✅; hired_employees source='app' (employee/probation), re-close без дубля ✅; cancelled → 0 hired, эстафету не двигает ✅; advisor чист (новых WARN нет, триггеры работают после REVOKE) ✅; tsc/lint 0. Тестовые строки вычищены.

**Git:** ветка `feature/bonuses-admin-vacancies` +3 коммита (`1541c2f` summary, `d48d4a8` миграции, `f376a34` код), запушена в origin (HEAD `f376a34`). **В `main` НЕ влита** (PR — после prod-блокеров).

### Открытые на следующие сессии
- ~~**Спека #2** — авто-укомплектованность (occupied из статусов вакансий)~~ → **СДЕЛАНО** (см. секцию выше; в проде, миграция `20260531062025`). Деление розница/компания осознанно НЕ делалось — укомплектованность общая.
- **Правка hh_only** → вариант Б: критерий `hh_refresh_token IS NOT NULL` (реально подключённые к HH), не `hh_manager_id`. Память: `hh-only-filter-criterion.md`.
- **Prod-блокеры до merge в main:** SEC-012 (`xlsx` HIGH, фикса нет → форк/CDN или принять риск), RLS-интеграционные тесты (Docker-прогон, `npm run test:integration` = 7 passed), CSP report-only → enforced.
- **Backlog:** Mango-колонка на /admin/integrations, head через HH (OAuth), favicon «Четвёртый форс», impersonation page-level overlay (fast-follow).

---

## 🔒 Security Review (4-23) — сессия 2026-05-30

**Статус: пройден полностью. SEC-001..008 закрыты.**

### Закрыто
| SEC | Проблема | Закрытие |
|---|---|---|
| **001** | 🔴 Утечка зарплат: `compute_manager_bonuses` (SECURITY DEFINER) исполнялась `anon` через REST RPC | **Доказано негатив-тестом: anon POST → 200 (28 строк, 143 000 ₽) → после фикса 401.** Миграция `20260530062400`: REVOKE anon + внутр. авторизация `auth.role()`/`auth.uid()` |
| 002/003 | data-RPC и триггер-функции исполнимы anon | REVOKE EXECUTE (миграция `20260530062400`) |
| 004 | 3 INSERT-политики `TO public WITH CHECK(true)` (audit_logs/error_logs/vacancy_snapshots) | DROP (миграция `20260530062400`) |
| 005 | mutable `search_path` у 6 функций | pin `search_path=public` |
| 006 | Нет security headers | `next.config.ts`: X-Frame-Options/HSTS/nosniff/Referrer + CSP **report-only** |
| 007 | OAuth `state=manager_id` (предсказуем, CSRF) | session-bound nonce: миграция `hh_oauth_states` + httpOnly-cookie + тройная сверка; `state` больше не manager_id |
| 008 | Debug-логи OAuth callback (утечка managerId/full_name в stdout) | удалены, оставлен error-лог без PII |

После каждого фикса: `tsc` 0; advisor `get_advisors(security)` — целевые WARN сняты. Осталось намеренно: `get_my_role` anon (RLS-зависимость user_profiles), `authenticated`-executable RPC (by design), INFO `hh_oauth_states` RLS-no-policy (только service_role).

### Backlog / блокеры до prod
| Пункт | Severity | Действие |
|---|---|---|
| **SEC-012 xlsx** | 🔴 HIGH-**блокер** | Prototype Pollution + ReDoS, фикса в npm нет. Мигрировать на патченный SheetJS (CDN) / форк `@e965/xlsx`, либо принять риск (вход admin-only). См. DEPLOY_CHECKLIST §6 |
| RLS-интеграционные тесты | 🔴 | Конфиг починен (`vitest.integration.config.ts`); **прогнать на машине с Docker** (`supabase start` → `npm run test:integration`, ожидаем 7 passed) |
| CSP report-only → enforced | 🟡 | После снятия отчётов на проде перевести в блокирующий режим |
| SEC-009 rate-limit логина | 🟡 | App-level нет; полагаемся на встроенные лимиты Supabase Auth |
| SEC-010 extensions в public | 🟢 | `moddatetime`/`pg_trgm` вынести в схему `extensions` |
| SEC-011 leaked-password protection | 🟢 | Включить в Supabase Auth → Password security |

### Git
- Ветка **`feature/bonuses-admin-vacancies`**, **8 коммитов**, запушена в `origin`, HEAD **`550adbf`**.
- **В `main` НЕ влита** — PR преждевременен до закрытия блокеров (SEC-012, RLS Docker-прогон).

### Ручная верификация — за пользователем
- Вход **head/admin** (видит всех) и **manager** (только свои) на `/bonuses`.
- Реальный **OAuth-флоу HH** с новым nonce (start → hh.ru → callback → `connected=1`).

### Незакрытый функционал (следующий Build)
- **Impersonation** (вход как менеджер) — требования безопасности проработаны, реализация не начата.
- **Mango-колонка** на `/admin/integrations`.
- Решение по **head через HH** (OAuth для роли head).
- **Favicon «Четвёртый форс»**.

---

## 🔥 Что делать первым в следующей сессии

### Незавершено из текущей сессии (FS-2 Блок 4)

**Тесты FS-2 — план готов, реализация не начата.**
Стек: Vitest + React Testing Library + jsdom.
Файлы создать:
```
vitest.config.ts
src/tests/setup.ts
src/tests/unit/nav.test.ts
src/tests/unit/api-helpers.test.ts
src/tests/api/access-control.test.ts      # матрица 9 эндпоинтов × 4 роли
src/tests/components/AdminVacanciesClient.test.tsx  # EC-8, оптимистичное обновление
src/tests/components/BonusRatesClient.test.tsx
src/tests/components/BonusesClient.test.tsx
src/tests/integration/rls-trigger.test.ts  # требует supabase start
```
Зависимости добавить в devDependencies:
```
vitest @vitejs/plugin-react @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```
Ключевой паттерн API-тестов: мокировать только `getAuthUser`, оставить `requireRole` и `handleApiError` реальными — это тестирует фактическую цепочку проверки ролей.
Интеграционные тесты (RLS + триггер `auto_create_bonus_on_close`) запускать отдельно через `npm run test:integration` с `supabase start`.

### Ожидает внешних действий (не код)
1. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»** — без этого май = 0 закрытых в KPI.
2. **SMTP для `/reset-password`** — Supabase Dashboard → Auth → SMTP.
3. **Татьяна** — выдать пароль/доступ.
4. **Применить миграции FS-2** в Supabase (если ещё не применены): `20260530000000`, `20260530010000`, `20260530020000`.

### Ближайшие код-задачи (по приоритету)
1. **Блок 4 (тесты FS-2)** — описание выше
2. **Cron-скрипты** — блокер снят:
   - `scripts/refresh-hh-tokens.ts` — первым
   - `scripts/sync-hh.ts`
   - `scripts/sync-mango.ts`
   - `scripts/generate-weekly-report.ts`
3. **`lib/telegram.ts`** + алерты в cron
4. **Удалить console.log** в `hh-csv/route.ts` — lint горит
5. **`/api/ai/report/[week]` + `/ai/report/[week]` page**
6. **trend_14d sparklines** в `/vacancies/[id]`
7. **Dashboard: Sheet-панель** при клике на менеджера + CSV export

---

## ✅ Что в проде

### Миграции (проект `twfmfmkqfhclzvdogvix`)

| Версия | Что добавляет |
|---|---|
| `20260522120000_initial_schema` | 14 таблиц, RLS, audit-триггеры, RPC `fuzzy_match_vacancy` / `find_vacancy_by_title`. |
| `20260523120000_fix_rls_write_policies` | Узкие head/admin write-политики; whitelist роли в `handle_new_user`. |
| `20260523123000_hh_vacancy_id_required_for_sheets` | (legacy, до перехода на лист «Data») |
| `20260523130000_audit_mask_hh_tokens` | Маска `hh_access_token` / `hh_refresh_token`. |
| `20260523140000_vacancy_snapshots_unique_per_day` | Дедуп; UNIQUE не создаётся (DELETE+INSERT в hh-csv). |
| `20260523141000_hr_manager_syncs_hh_manager_id` | `+hh_manager_id TEXT` partial UNIQUE. |
| `20260523150000_vacancies_sheets_fields` | `+location` / `customer_name` / `positions_count`. |
| `20260523160000_hired_employees_probation_status` | `+status` ('hired'/'probation'). |
| `20260523170000_cleanup_header_rows_in_managers` | Удаление фантомных `'HR менеджеры'` / `'Нг менеджеры'`. |
| `20260523180000_bonus_rates` | Таблица `bonus_rates` + GIN trigram + RPC `compute_manager_bonuses`. |
| `20260523190000_hh_manager_stats_paid_columns` | `+resume_views_from_search` / `+invitations_from_db`. |
| `20260523200000_bonus_rates_group_name` | `+group_name` для группировки тарифов. |
| `20260523210000_seed_bonus_rates` | Идемпотентный seed 16 стартовых тарифов (Розница / Офис). |
| `20260523220000_vacancies_unique_title_manager_opened` | Partial UNIQUE `(manager_id, title, opened_at) WHERE hh_vacancy_id IS NULL`. |
| `20260524000000_vacancy_snapshots_funnel_fields` | RENAME `invitations_sent`→`invitations_from_responses`; ADD `invitations_from_db`, `calls_count`. |
| `20260524100000_vacancy_snapshots_is_locked` | `+is_locked BOOLEAN` + partial index для lock-period. |
| `20260524110000_vacancy_snapshots_is_closed` | `+is_closed BOOLEAN` (для аудита «когда HH узнал»). |
| `20260524120000_vacancy_snapshots_source_allow_hh_csv` | **CHECK FIX:** разрешён `source='hh_csv'`. |
| `20260524130000_compute_manager_bonuses_from_vacancies` | RPC переключён `hired_employees` → `vacancies.closed_at`; threshold 0.6 → 0.4. |
| `20260524140000_seed_bonus_rates_full` | Полный каталог из листа «Бонусы_HR»: 58 позиций в 6 группах. |
| `20260524150000_bonus_rates_aliases_cleanup` | +8 алиасов; удаление 3 orphan'ов от первого seed. |
| `20260524170000_compute_manager_bonuses_exclude_phantoms` | RPC: фильтр `google_sheet_row IS NOT NULL`. |
| `20260524180000_compute_manager_bonuses_drop_sheet_row_filter` | **Откат**: RPC считает по ВСЕМ `vacancies WHERE status='closed'`. |
| `20260524190000_vacancies_priority` | `+priority TEXT CHECK IN ('высокий','средний','низкий')`, nullable. |
| `20260524200000_vacancies_google_sheet_row_unique_key` | Cleanup дублей + DROP UNIQUE `hh_vacancy_id` + CREATE partial UNIQUE INDEX `google_sheet_row_idx`. |
| `20260524210000_drop_vacancies_title_manager_opened_unique` | DROP `uq_vacancies_title_manager_opened_no_hh`. |
| `20260527000000_staffing_plan` | Таблица `staffing_plan` (город/должность/план) + RLS + audit-триггер. |
| `20260527010000_staffing_plan_compute_rpc` | RPC `compute_staffing_plan` (SECURITY DEFINER): occupied из `hired_employees`, in_progress из `vacancies`. |
| `20260528000000_template_onboarding` | Таблица `template_uploads` (XLSX онбординг). |
| `20260528010000_template_uploads_preview_data` | `+preview_data JSONB` в `template_uploads`. |
| `20260529000000_vacancy_request` | `vacancies`: +request_* поля, +confidentiality, +internal_ref. RPC `gen_internal_ref()`. Триггер `enforce_request_approval`. RLS `vacancies_request_approve`. |
| `20260529010000_vacancy_request_fixes` | Триггер: guard только при `requested_by IS NOT NULL`. RLS: `auth.uid() IS DISTINCT FROM requested_by`. |
| `20260529020000_hr_manager_syncs_hh_id_full_index` | Полный индекс на `hh_manager_id` для diff-builder lookup. |
| `20260529030000_staffing_plan_occupied_units` | `staffing_plan.occupied_units INTEGER NOT NULL DEFAULT 0`. RPC: `occupied = occupied_units`, `vacant = planned - occupied_units - in_progress`. |
| `20260529040000_drop_hr_bonuses_table` | **DROP TABLE hr_bonuses CASCADE** — была пустой с создания. |
| `20260530000000_recreate_hr_bonuses` | **Воссоздана** `hr_bonuses` (vacancy_id, manager_id, amount_kopecks, status IN pending/unmatched/paid/cancelled, source, matched_position_name snapshot). UNIQUE(vacancy_id). RLS: SELECT — свой + head/admin/executive; INSERT/UPDATE — head/admin. Audit-триггер. |
| `20260530010000_auto_bonus_trigger` | Триггер `trg_auto_create_bonus_on_close` (BEFORE UPDATE) на `vacancies`: при переходе status→'closed' fuzzy-match (pg_trgm similarity ≥ 0.4) → создаёт `hr_bonuses` со status='pending' или 'unmatched'. Дубль-guard: IF EXISTS → RETURN NEW. |
| `20260530020000_bonus_rates_admin_only` | RLS `bonus_rates` INSERT/UPDATE/DELETE ужесточены до `role='admin'` (было head/admin). |
| `20260530062400_harden_rpc_grants_and_rls` | **Security (SEC-001..005):** REVOKE EXECUTE у anon для data-RPC + у anon/authenticated для триггер-функций; внутр. авторизация `compute_manager_bonuses` (`auth.role()`/`auth.uid()`); DROP 3 INSERT-политик `TO public WITH CHECK(true)`; pin `search_path=public` у 6 функций. `get_my_role` EXECUTE сохранён (RLS-зависимость). |
| `20260530072339_harden_oauth_state_nonce` | **Security (SEC-007):** таблица `hh_oauth_states` (nonce PK gen_random_uuid, manager_id FK CASCADE, TTL 10 мин, индекс по expires_at). RLS без политик → только service_role. TTL-очистка: оптоочистка в `/start` + одноразовое гашение в callback. |

Типы `src/types/database.ts` синхронизированы (hr_bonuses, bonus_rates, **hh_oauth_states** обновлены).

### API

- `dashboard/team`, `dashboard/manager`, `dashboard/me`, `dashboard/divisions`,
  `stats/politeness` — все принимают `?month=YYYY-MM` (MonthPicker).
- **«Активные вакансии»** — `status='active' AND hh_vacancy_id IS NOT NULL`.
- **«Закрыто»** — `status='closed' AND closed_at ∈ month` без доп. фильтров.
- `divisions` — фильтр: `google_sheet_row IS NOT NULL OR internal_ref IS NOT NULL OR requested_by IS NOT NULL`.
- `bonuses/` — RPC `compute_manager_bonuses`, fuzzy-match threshold 0.4. 93 тарифа в проде.
- **KPI «Звонки»** — `SUM(calls_count) FROM vacancy_snapshots`.
- `sync/sheets/` — дедуп `google_sheet_row`, авто-создание пользователей.
- `POST /api/sync/lock-period?month=YYYY-MM` — фиксирует `is_locked`.
- **Заявки на вакансию:** POST/PATCH /api/vacancies/requests/[id]/{approve|reject|activate}.
- **Онбординг XLSX:** GET /api/templates/[type]/download · POST /api/templates/upload · POST apply · GET error-report.
- **HH OAuth:** GET /api/auth/hh/start?manager_id · GET /api/auth/hh/callback.
- **Staffing plan:** GET/POST/DELETE /api/staffing/plan · GET /api/staffing/plan/options · GET /api/staffing/availability.
- **Bonus-rates CRUD (admin):** GET/POST /api/admin/bonus-rates · PATCH/DELETE /api/admin/bonus-rates/[id] · GET /api/admin/bonus-rates/[id]/history.
- **hr_bonuses:** GET /api/bonuses?status= · PATCH /api/bonuses/[id]/match · PATCH /api/bonuses/[id]/mark-paid · DELETE /api/bonuses/[id].
- **Admin vacancies:** GET /api/vacancies/admin (head/admin/executive) · PATCH /api/vacancies/[id] (расширен: title/location/subdivision/manager_id/status/closed_at) · POST /api/vacancies (расширен: confidential auto-generates internal_ref).

### UI

- `/dashboard` — Tabs «Сегодня/Неделя» + MonthPicker. KPI-ряд 5 карточек. Воронка.
- `/dashboard/efficiency` — «Бонус за месяц», ИВ с платными метриками.
- `/dashboard/divisions` — карточка городов + «Закрыто за период».
- `/vacancies` — «Город», «Дней в работе» (цвет + ⚠️), сортировка, truncate.
- `/bonuses` — таблица с группировкой по менеджеру, sub-total, grand-total; табы «Начисленные / Без сопоставления / Выплаченные»; модал «Привязать тариф»; кнопка «Выплачено» (admin, only pending).
- `/cabinet` — «Мой бонус за месяц».
- `/sync` — «Зафиксировать месяц».
- `/requests` — табы pending/approved/rejected, модалка создания, ApprovalActions, ActivateModal.
- `/onboarding` — 3-шаговый мастер (только admin): скачать шаблон → загрузить → применить.
- `/staffing/plan` — StaffingPlanTable: плоская таблица, фильтр по городу, подытоги, tfoot ИТОГО.
- `/admin/integrations` — HH OAuth кнопка.
- **`/admin/bonuses`** *(новое, admin only)* — BonusRatesClient: таблица тарифов с группировкой по group_name, inline edit (Enter/Esc), History modal (audit_logs таймлайн), кнопки «Добавить тариф» / «Импорт XLSX».
- **`/vacancies/admin`** *(новое, head/admin/executive)* — AdminVacanciesClient: Sheets-style таблица всех вакансий (open+confidential+draft), VacancyStatusCell (Popover + Calendar при closed), VacancyEditableCell (double-click), sticky фильтры, CSV export, VacancyCreateModal; EC-6: у executive колонка «Менеджер» пустая + Tooltip.

### Sidebar (nav.ts)

| Роль | Новые пункты |
|---|---|
| executive | «Все вакансии» → `/vacancies/admin` (после «Штатное расписание») |
| head | «Все вакансии» → `/vacancies/admin` (после «Вакансии») |
| admin | «Все вакансии» → `/vacancies/admin` (после «Вакансии») + «Тарифы бонусов» → `/admin/bonuses` (после «Бонусы») |

### Sync — особенности

- Sheets дедуп вакансий = `google_sheet_row` (singular key).
- `hr_manager_syncs` дедупируется по `sheet_full_name` ИЛИ `hh_manager_id`.
- `rublesToKopecks` в `lib/utils.ts`.
- HH OAuth callback **не проверяет сессию** (намеренно, cross-domain).
- XLSX upload: лимит 10 МБ, проверка владельца перед apply.

---

## ⬜ Ожидающие задачи

### По SPEC — не реализовано

| Приоритет | Задача | Зависит от |
|---|---|---|
| 🔴 | **FS-2 Блок 4: тесты** (Vitest, план готов) | — |
| 🔴 | `scripts/refresh-hh-tokens.ts` | — |
| 🔴 | `scripts/sync-hh.ts` | ~~HH OAuth партнёр~~ **подтверждён** |
| 🔴 | `scripts/sync-mango.ts` | Mango .env |
| 🔴 | `scripts/generate-weekly-report.ts` | Anthropic API |
| 🔴 | `lib/telegram.ts` + алерты в cron | — |
| 🟡 | `GET /api/ai/report/[week]` + `/ai/report/[week]` page | — |
| 🟡 | trend_14d sparklines в `/vacancies/[id]` | — |
| 🟡 | Dashboard: Sheet-панель при клике на менеджера | — |
| 🟡 | Dashboard: CSV export | — |
| 🟡 | Executive: графики «Выведено по месяцам» + «Открытые вакансии» | — |
| 🟢 | Cabinet: PencilLine индикатор при `calls_source='manual'` | — |
| 🟢 | Timestamp «Данные актуальны на HH:MM» в воронке вакансии | — |

### Прод-операции
1. **43 фантомные закрытые вакансии** — добавить в лист «Data» → sheets-sync.
2. **SMTP** — Supabase Dashboard → Auth → SMTP.
3. **Татьяна** — выдать пароль/доступ.
4. **Применить миграции FS-2** (20260530000000–020000) если не применены.

### Cleanup
- `console.log` в `hh-csv/route.ts` — удалить (lint no-console горит).
- `politeness_company` (hh_manager_stats WHERE manager_id IS NULL) — нигде не используется в UI.
- Middleware ролевых редиректов (из ревью).

---

## ⚠️ Ключевые решения, отличающиеся от SPEC

1. Окно редактирования активностей — **30 дней** (не 7).
2. Статус KPI — **`'lagging'`** (не `'behind'`).
3. service-role в `/dashboard/team` и `/divisions` (RLS не пускает executive).
4. `hires_per_month` НЕ масштабируется — «Закрыто» всегда полный месяц.
5. HH CSV — основная архитектура, OAuth — дополнение.
6. Google Sheets лист **«Data»** (не «Вакансии»).
7. `avg_response_hours` убран из UI.
8. `politeness_company` — weighted avg, исключает `politeness_index = 0`.
9. `/reset-password` без префикса `/auth/`.
10. PostgreSQL **17**.
11. Авто-создание `auth.users` при sync (Sheets + hh-csv politeness).
12. **hr_bonuses**: воссоздана с UNIQUE(vacancy_id); триггер fuzzy-match threshold 0.4; `matched_position_name` — snapshot тарифа (изменение `bonus_rates` не пересчитывает старые бонусы).
13. Стажировка — 7-й этап воронки (`hired_employees.status='probation'`, вакансия `active`).
14. Город `vacancies.location` — отдельная колонка.
15. Платные/бесплатные HH действия разделены в `hh_manager_stats`.
16. Дедуп вакансий из Sheets — singular key `google_sheet_row`.
17. «Закрыто вакансий» — всегда за полный календарный месяц во всех API.
18. Sheets статусы: `закрыта→closed`, `стажировка→active+probation`, `приостановлена/предзакрыта→paused`.
19. Фильтры KPI: `team/me/manager` «Активные» = `status='active' AND hh_vacancy_id IS NOT NULL`; `divisions` «Закрыто» + `(google_sheet_row IS NOT NULL OR internal_ref IS NOT NULL OR requested_by IS NOT NULL)`.
20. Воронка дашборда полностью из `vacancy_snapshots`. KPI «Звонки» = `SUM(calls_count)` из snapshots.
21. MonthPicker на `/dashboard`: Tabs «Сегодня/Неделя» + Select последних 12 месяцев.
22. Lock-period: `vacancy_snapshots.is_locked`.
23. Бонусы: RPC `compute_manager_bonuses`, threshold 0.4, без фильтра google_sheet_row. 93 тарифа.
24. 87 «фантомных» вакансий (google_sheet_row IS NULL) — оставлены в БД для аудита, попадают в KPI.
25. `vacancies.priority` — nullable TEXT, заполняется sheets-sync, UI показывает цветную эскалацию.
26. Заявки на вакансию: `draft→approved→active`; конфиденциальные = `CONF-2026-NNNN` через `gen_internal_ref()`.
27. `divisions` фильтр расширен: `google_sheet_row OR internal_ref OR requested_by IS NOT NULL`.
28. **`staffing_plan.occupied_units`** — ручной ввод (не из `hired_employees`). Формула: `vacant = planned - occupied_units - in_progress`.
29. **HH OAuth callback без проверки сессии** — намеренно (cross-domain redirect).
30. **`rublesToKopecks` в `lib/utils.ts`** (перенесена из google-sheets.ts).
31. **`bonus_rates` write-политики** — ужесточены до `role='admin'` (было head/admin).
32. **EC-6 /vacancies/admin**: executive видит список вакансий, но `manager` и `manager_id` возвращаются `null` из API. CSV export тоже пустой по колонке менеджера.
33. **VacancyStatusCell**: не оптимистичный — `onUpdated` вызывается только после успешного PATCH (не до). Rollback implicit: при ошибке вызова `onUpdated` не происходит.

---

## 📝 Последние коммиты

### Текущая сессия (2026-05-30) — Security Review + code-review (8 коммитов)

```
550adbf fix(security): OAuth session-bound nonce (SEC-007)
ea0934f fix(security): чистка debug-логов OAuth callback (SEC-008)
37928eb feat(security): security headers + CSP report-only (SEC-006)
eadf27c chore: gitignore supabase/.temp + удалить из индекса (housekeeping)
57b506d docs: DEPLOY_CHECKLIST — security audit (SEC-001..012) + RLS-блокер двухчастный
28a2fd2 fix(test): integration-сьют запускаем + sync lockfile (test toolchain)
cc38324 fix(security): harden RPC grants + RLS (SEC-001..005)
83f9033 fix: code-review — upsert error-checks, parseClosedMonth year, dedup типов
```

Запушено в `origin/feature/bonuses-admin-vacancies` (HEAD `550adbf`). В `main` не влито.
Применены миграции: `20260530062400` (SEC-001..005), `20260530072339` (SEC-007 nonce).

### Предыдущая сессия (2026-05-29, вечер) — FS-2 Блоки 1–3

```
dfebec5 feat(api): FS-2 Блок 2 — bonus routes, bonus-rates CRUD, vacancies/admin
f8f76fd feat(db): FS-2 Блок 1 — hr_bonuses + auto_create_bonus_on_close + bonus_rates admin-only RLS
```

Working tree: только `HANDOFF.md` (этот апдейт).
