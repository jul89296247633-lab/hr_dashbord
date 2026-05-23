# HANDOFF — HR Control Tower

> Сводка состояния проекта для передачи сессии. Дата: 2026-05-23.
> Источник истины по требованиям — `SPEC.md`. Правила — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui (вручную), Supabase, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npx next lint`, `next build` — **все три зелёные**.
(Сборка прогоняется с фиктивными env: `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.)

---

## ✅ Что сделано

### Data Model (готово)
- `supabase/migrations/20260522120000_initial_schema.sql` — 14 таблиц, RLS на всех, audit-триггеры, RPC `fuzzy_match_vacancy` / `find_vacancy_by_title`.
- `supabase/config.toml`, `supabase/README.md`.
- ⚠️ Миграция к живой БД **не применялась** (в окружении нет Supabase CLI/Docker). Типы `src/types/database.ts` написаны **вручную** по миграции (совместимы с `supabase gen types`).

### API-слой (готово — 36 route-файлов в `src/app/api/`)
- **activities**: `GET /[date]`, `POST`
- **vacancies**: `GET`, `POST`, `GET /[id]`, `PATCH /[id]`, `GET /[id]/funnel`
- **dashboard**: `GET /team`, `/manager`, `/me`, `/divisions`
- **plans**: `GET`, `POST`, `GET /[manager_id]`
- **staffing**: `GET`, `POST`
- **sync**: `POST /sheets`, `POST /hh` (+`GET` статус), `POST /mango`, `POST /hh-csv`, `GET /logs`
- **stats**: `GET /politeness`
- **bonuses**: `GET`, `GET /summary`, `PATCH /[id]/match`
- **ai**: `GET /insights`, `POST /insights/generate`, `PATCH /insights/[id]/read`, `GET /report/[week]`
- **admin**: `GET/POST/PATCH users` (+`/invite`, `/[id]`), `GET audit-logs` (+`/[id]`), `GET error-logs` (+`/[id]/resolve`), `POST integrations/sheets/test`, `GET integrations/hh` (+`/[manager_id]/connect`, `DELETE /[manager_id]`)
- Хелперы: `lib/api-helpers.ts` (getAuthUser, requireRole, apiError/apiSuccess, handleApiError, getPeriodRange, workdaysBetween, kpiPct, calcManagerStatus), `lib/supabase/{server,client,middleware,admin}.ts`, `lib/validations.ts`, `lib/google-sheets.ts`, `lib/hh-csv-parser.ts`, `lib/hh-api.ts`, `lib/mango.ts`, `lib/ai/*`.
- ⚠️ Внешние интеграции (HH API, Манго, Google Sheets, Anthropic) проверены **только компиляцией** — без реальных кредов не верифицированы.

### UI (Блок 4) — ГОТОВО (все экраны SPEC Блок 0 имеют фронтенд)
- **Фаза 1 (фундамент, готово):** Tailwind v4 + тема (`globals.css`), shadcn/ui компоненты вручную (`components/ui/*`), `Toaster` (sonner), `/login` (`(auth)/login`), `(app)/layout.tsx` (sidebar по роли + Header + mobile drawer), `middleware` (redirect по роли).
- **Фаза 2a (готово):** `/cabinet` + `/cabinet/[date]` (US-001) — CabinetView/Client, ActivityForm (RHF+Zod, AbortController 10с, localStorage-черновик), KpiBar, DatePicker (react-day-picker), Alert.
- **Фаза 2b (готово):** `/dashboard` (сводный, head/admin/executive) — StaffingCard(+Dialog), KpiCards, TeamFunnel, DivisionCards, TeamTable, табы периода. Клиентский, тянет `/api/dashboard/team` + `/divisions` + `/staffing` + `/stats/politeness`.
- **Фаза 2c (готово):** `/dashboard/manager` (личный) — KPI+статус, by_day таблица, табы периода, Select менеджера для head/admin (`ui/select.tsx`). executive → редирект на `/dashboard`.
- **Фаза 2d (готово):** `/dashboard/efficiency` (head/admin) — ИВ компании, полная таблица (звонки/собеседования/выведено/ИВ+Tooltip/бонусы/статус), фильтр периода+менеджера, аккордеон бонусов (`ui/collapsible.tsx`). Тянет team + stats/politeness + bonuses/summary. ⚠️ Sheet-детализация менеджера и экспорт CSV не сделаны (кнопка disabled).
- **Фаза 2e (готово):** `/dashboard/divisions` (head/admin/executive) — Select подразделения + табы week/month/quarter, список подразделений (Collapsible), раскрытие → таблица вакансий с мини-воронкой и AlertTriangle при days_open>45. Фильтр подразделений на клиенте.
- **Фаза 2f (готово):** вакансии — `/vacancies` (список: фильтр статуса, пагинация, «Создать» для head/admin), `/vacancies/[id]` (воронка 6 этапов + конверсии, период-табы, sync HH, breadcrumb, 404-карточка), `/vacancies/new` + `/vacancies/[id]/edit` (VacancyForm, RHF+Zod, Select менеджера/статуса, 409 toast). ⚠️ Тренд-график (recharts) и мини-воронка в списке не делались — нет данных в API.
- **Фаза 2g (готово):** `/bonuses` — сводные карточки (начислено/выплачено/ожидают из bonuses/summary), таблица с фильтрами (статус + менеджер для head/admin) и пагинацией, подсветка несопоставленных + Alert, ручная привязка через MatchDialog (PATCH /api/bonuses/[id]/match). ⚠️ DateRange-фильтр и экспорт CSV не делались.
- **Фаза 2h (готово):** `/plan` (head/admin) — таблица планов по менеджерам (без плана → дефолты 15/5/15/5 серым), изменение через PlanDialog (RHF+Zod, POST /api/plans, effective_from опц.). ⚠️ Sheet истории планов не делал — нет эндпоинта полной истории (только активный план).
- **Фаза 2i (готово):** `/staffing` — крупный % (цвет ≥80/60–79/<60), история 20 записей (дата/%/комментарий/кто), Dialog обновления для head/admin (POST /api/staffing). Read-only для остальных ролей.
- **Фаза 2j (готово):** `/sync` (карточки запуска Sheets/HH/Манго + статус HH; загрузка CSV 3 типов через FormData на /api/sync/hh-csv) + `/sync/logs` (журнал, фильтры источник/статус, пагинация). head/admin.
- **Фаза 2k (готово):** `/ai` (секции аномалии/прогнозы/рекомендации/отчёты, бейдж непрочитанных, фильтр, mark-read, Markdown через `ui/markdown.tsx`+react-markdown, GenerateDialog по типу→менеджер/вакансия, 429 toast) + `/ai/report/[week]` (Markdown + мета-панель + print, 404-карточка). head/admin. ⚠️ «Скачать PDF» (puppeteer) не делал.
- **Фаза 2l (готово):** админка — `/admin/users` (таблица + invite/edit Dialog + toggle active), `/admin/integrations` (HH-токены: статусы/connect/revoke + тест Google Sheets), `/admin/logs` (Tabs Ошибки[+resolve, Sheet деталей]/Аудит[diff-сводка]). Только admin. ⚠️ DateRange/экспорт CSV не делал.

---

## 🔄 Что в процессе прямо сейчас
- **Весь Блок UI завершён.** Пройден шаг 4.5 (кросс-модельное ревью на Sonnet).
- **✅ Все 4 🔴-блокера ревью закрыты** (см. секцию ниже). Активной задачи нет.
- Дальше: (1) cron-скрипты (Промпт B в HANDOFF), (2) деплой; по желанию — добрать 🟠.

---

## ⬜ Что осталось

### Cron-скрипты (Beget VPS, `scripts/`) — НЕ начато. **Следующий шаг.**
- `sync-hh.ts` (воронка HH, 8–22 пн-пт), `sync-mango.ts` (звонки, 20:00), `refresh-hh-tokens.ts` (7:00), `generate-weekly-report.ts` (пт 20:30, AI weekly_report).
- Логика частично переиспользуема из `lib/hh-api.ts` / `lib/mango.ts`. Нужен `tsconfig.scripts.json` + pm2-конфиг.

### Деплой / инфраструктура — НЕ начато
- Применить миграцию (`supabase db push`), `supabase gen types` → перезаписать `database.ts`.
- Создать первого admin-пользователя (Supabase Auth + профиль).
- Vercel (фронт) env, Beget VPS (cron) env — заполнить по `.env.example`.
- Реальные креды интеграций; прогнать sync-эндпоинты на живых данных.
- pg_cron очистка `error_logs` (>90 дней).

---

## 🔬 Шаг 4.5 — кросс-модельное ревью (код писал Opus → ревью на Sonnet)

Проведено перед деплоем двумя read-only Sonnet-агентами (безопасность + корректность).
**Все 🔴-блокеры закрыты в коде/миграциях (2026-05-23).** Полные находки — ниже, приоритизировано.
Перед prod-деплоем: применить новую миграцию `20260523120000_fix_rls_write_policies.sql`
к живой БД (`supabase db push`) и при возможности добрать 🟠.

### 🔴 Блокеры — ✅ ЗАКРЫТЫ 2026-05-23
1. **RLS-дыра `FOR ALL WITH CHECK (TRUE)`** — ✅ `supabase/migrations/20260523120000_fix_rls_write_policies.sql`. Дропнуты 7 широких политик (cron всё равно ходит под service_role и обходит RLS). Для `daily_activities` и `ai_insights` добавлены узкие head/admin INSERT+UPDATE (там есть API-пути под RLS-клиентом). На живой БД — применить миграцию (`supabase db push`) и убедиться, что менеджер через PostgREST не может DELETE чужие строки.
2. **`handle_new_user` whitelist роли** — ✅ та же миграция: `CREATE OR REPLACE FUNCTION` с проверкой `IN ('manager','head','executive','admin')`, иначе fallback `'manager'`. Дополнительно `supabase/config.toml` уже `enable_signup = false`; для prod проверить ту же настройку в Supabase Dashboard.
3. **`hires` KPI масштабирование** — ✅ `src/lib/api-helpers.ts::scaledHiresPlan(monthly, from, to)` (план × workdays_period / workdays_in_month_of_to). Применён в `/api/dashboard/{team,manager,me}`.
4. **`/api/stats/politeness?period=today` маппинг** — ✅ в `EfficiencyClient` и `DashboardClient` `today→week` перед запросом politeness (и bonuses/summary в Efficiency).

Бонусом закрыто 🟠: `ai_insights` SELECT-политика — убран leak `weekly_report` (manager_id IS NULL) для менеджеров через прямой PostgREST.

### 🟠 Major (до prod, не блокируют функционал)
- Middleware не делает ролевых редиректов — защита только в page-guard'ах (хрупко при добавлении новых страниц).
- RLS `ai_insights`/`hh_manager_stats`: `manager_id IS NULL` виден любому авторизованному (weekly_report/ИВ компании) — при прямом доступе к БД менеджер увидит. API закрыт `requireRole`.
- `PATCH /api/admin/users/[id]`: admin может разжаловать/деактивировать сам себя или последнего admin — нет защиты.
- CSV-загрузка `/api/sync/hh-csv` без лимита размера файла (DoS).
- `politeness_company` пишется через DELETE+INSERT (неатомарно) — заменить на upsert.
- `lib/ai/client.ts`: `JSON.parse` ответа модели без try/catch → 500 без диагностики.
- AI rate-limit по `triggered_by=user.id`, а CLAUDE.md §9 требует «на компанию».
- Audit-триггер пишет `hh_access_token`/`hh_refresh_token` в `audit_logs.new_values` — маскировать.
- executive в `/api/dashboard/team` получает массив обезличенных менеджеров; SPEC US-007 показывает `managers: null`.

### 🟡 Minor
- Таймзоны: `forecast.ts`/`isoWeekRange` на UTC, `workdaysBetween`/`getPeriodRange` на localtime — унифицировать.
- `kpiPct` (0.1%) vs `KpiBar` (1%) — разная точность.
- `isoWeekSchema` допускает `W00`/`W99`.
- divisions/funnel: загрузка всех snapshot без `limit` на вакансию (перф при росте данных).
- `employment_type` intern из Sheets определяется по колонке «Тип найма», которой может не быть (SPEC говорит про «Статус»).
- voronka вакансии: первые 3 этапа — накопительно за всё время, остальные — за период (смешанные данные; в SPEC был `note`).

**Вердикт ревью:** архитектура и авторизация в целом крепкие (getUser не getSession; service_role не утекает в клиент; HH-токены не отдаются; Zod до БД; UUID-валидация). Перед prod закрыть 4 🔴 + желательно 🟠.

---

## ⚠️ Ключевые решения, отклоняющиеся от SPEC
1. **Окно редактирования активностей — 30 дней** (а не 7 из SPEC §5.2/US-001). Зафиксировано в `POST /api/activities` (`DATE_TOO_OLD`) и в кабинете (граница readonly). Сохранено в memory проекта. **Не откатывать к 7.**
2. **Статус KPI: `'lagging'`** (а не SPEC `'behind'`) для 70–89% — по явному указанию пользователя. Метки UI: «В плане»/«Отставание»/«Критично».
3. **service-role в `/api/dashboard/team` и `/divisions`** — RLS не пускает `executive` к `daily_activities`/`user_profiles`; читаем через `lib/supabase/admin.ts` после `requireRole`, executive отдаём без имён (EC-09).
4. **Имена под реальную схему БД:** тело `POST /api/plans` использует `hires_per_month` / `vacancies_limit` (в ТЗ были `hired_per_month`/`vacancy_limit`); таблица укомплектованности — `staffing_records` (в ТЗ упоминалась `staffing_snapshots`); politeness пишется в `hh_manager_stats` (отдельной `hh_politeness_stats` нет).
5. **HH CSV type-маппинг:** `calls`→`calls`, `politeness`→`politeness_managers`, `company_politeness`→`politeness_company`. Авто-источник HH-звонков в кабинете — `hh_csv` (а не `hh_api`).
6. **`subdivision` исключён** из admin invite/update — такой колонки в `user_profiles` нет (она в `vacancies`).
7. **`/dashboard/divisions`: `plan_completion_pct = null`** — плана на уровне подразделения в схеме нет; воронка агрегируется по данным вакансии (snapshots+найм), звонки/собеседования (по менеджеру) в неё не входят.
8. **AI generate** упрощён до одного инсайта по `{type, manager_id?/vacancy_id?}`; промпты унифицированы под JSON `{title, body_md, severity}`.
9. **Fuzzy-сопоставление менеджеров в `hh-csv`** упрощено (exact-normalize + фолбэк по фамилии); выделенной RPC по именам нет (`fuzzy_match_vacancy` — только для названий вакансий).
10. **Тех-зависимости:** `@supabase/ssr` поднят до 0.10.3 (старый 0.5.2 ломал типизацию в `never`); shadcn-компоненты написаны **вручную** (CLI интерактивен); DatePicker на `react-day-picker` v10 со штатными стилями.

---

## ▶️ Следующий шаг — готовый промпт

> 🔴-блокеры закрыты. Дальше: cron-скрипты. По желанию — пройтись по 🟠 (см. выше).

### Промпт — cron-скрипты
````
Прочитай SPEC.md (§5.4 sync-hh, §5.5a Манго, §5.10 AI weekly_report, §5.9 cron-расписание,
Блок 0 переменные окружения Beget VPS), CLAUDE.md, и готовую логику lib/hh-api.ts,
lib/mango.ts, lib/ai/* (их можно переиспользовать).

Блок Cron — скрипты для Beget VPS (pm2-cron). НЕ Next.js — отдельные node-скрипты на
service-role клиенте (createClient supabase-js с SUPABASE_SERVICE_ROLE_KEY, без cookies).

Создай в scripts/:
- sync-hh.ts — воронка HH по активным вакансиям (см. lib/hh-api.ts runHhSync; cron 0 8-22/2 * * 1-5),
  пишет vacancy_snapshots, рефреш токенов, sync_logs (source 'hh').
- sync-mango.ts — звонки за день (см. lib/mango.ts runMangoSync; cron 0 20 * * 1-5),
  upsert daily_activities, sync_logs (source 'mango').
- refresh-hh-tokens.ts — обновление HH OAuth токенов (cron 0 7 * * *).
- generate-weekly-report.ts — AI weekly_report + аномалии/прогнозы по всем менеджерам
  (cron 30 20 * * 5), INSERT ai_insights (triggered_by 'cron').
- tsconfig.scripts.json (CommonJS/node) + ecosystem.config.js (pm2) с расписаниями выше.
- Логирование ошибок через error_logs (source cron_hh/cron_mango/cron_ai); Telegram-алерт критичных.

ВАЖНО: скрипты вне Next-сборки — не ломать `next build`. Сборка скриптов: tsc -p tsconfig.scripts.json.
Зависимости (@supabase/supabase-js и т.д.) уже есть. Не вызывать Next-only API. Обнови HANDOFF.md.
````
