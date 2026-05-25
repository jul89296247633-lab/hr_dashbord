# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-25 (ночь)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🔥 Что делать первым в следующей сессии

**Главное изменение в этой сессии — модель upsert для `vacancies` переписана:**
теперь **`google_sheet_row` — единственный ключ дедупа** в `sheets-sync`. Никаких
lookup'ов по `hh_vacancy_id` или `(title, manager_id, opened_at)`. Каждая строка
листа Data ↔ ровно одна запись в БД. Это потребовало снять UNIQUE на
`hh_vacancy_id` и partial UNIQUE на `(title, manager_id, opened_at)` — иначе
INSERT'ы с совпадающими полями (Sheet-row vs фантом) валились 23505. После
cleanup'а 15 групп дублей `google_sheet_row` — в БД 93 Sheet-row + 129 фантомов.

**Фильтр `google_sheet_row IS NOT NULL` оставлен только в /divisions** для
подсчёта закрытых и бонусном RPC уже **снят** — теперь бонусы считаются по
ВСЕМ `vacancies WHERE status='closed' AND closed_at ∈ period`. На дашбордах
team/me/manager фильтр google_sheet_row тоже снят (active вернулась к
`hh_vacancy_id IS NOT NULL`, closed — без фильтра).

**Что ждёт пользователя (внешняя работа, не код):**

1. **Запустить `/sync` → проверить новую модель upsert.** Если упадёт с UNIQUE
   violation — пришли скриншот, разберём. Уже сняты `vacancies_hh_vacancy_id_key`
   и `uq_vacancies_title_manager_opened_no_hh`; остался только нужный
   `vacancies_google_sheet_row_idx`.
2. **Добавить колонку «Приоритет» в лист Data** (если ещё нет) с одним из значений
   `высокий` / `средний` / `низкий`. Парсер `sheets/route.ts` уже умеет, поле
   `vacancies.priority` уже есть в БД (миграция `20260524190000`). UI `/vacancies`
   показывает индикатор: цветной текст «Дней в работе» + ⚠️ по эскалации.
3. **Добавить колонку «Месяц закрытия»** для закрытых без точной даты (русское
   название месяца, год хардкод 2026). Fallback в `sheets/route.ts` уже есть
   (коммит `89f2b30`).
4. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»** — список
   выгружался в предыдущей сессии. После добавления + sheets-sync они появятся
   в KPI и бонусах. **Сейчас в БД по-прежнему 0 закрытых из листа Data.**

**Возможная следующая код-задача:** /api/vacancies `POST` ловил `23505` на
дубликат `hh_vacancy_id` и возвращал `HH_VACANCY_ID_EXISTS 409` — после dropа
UNIQUE этот handler не сработает. Если ручное создание используется и защита
нужна — переделать на pre-check (`.maybeSingle()` по `hh_vacancy_id` перед INSERT).

---

## ✅ Что в проде

### Миграции (проект `twfmfmkqfhclzvdogvix`, все применены через MCP)

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
| `20260524120000_vacancy_snapshots_source_allow_hh_csv` | **CHECK FIX:** разрешён `source='hh_csv'` (было только `'hh_api'`/`'manual'`). Это была причина пустого `vacancy_snapshots` после CSV — `.insert(...)` молча ловил 23514. |
| `20260524130000_compute_manager_bonuses_from_vacancies` | RPC переключён `hired_employees` → `vacancies.closed_at`; threshold 0.6 → 0.4. |
| `20260524140000_seed_bonus_rates_full` | Полный каталог из листа «Бонусы_HR»: 58 позиций в 6 группах. |
| `20260524150000_bonus_rates_aliases_cleanup` | +8 алиасов (Продавец-консультант, Хостес/администратор, и т.п.); удаление 3 orphan'ов от первого seed. |
| `20260524170000_compute_manager_bonuses_exclude_phantoms` | RPC: добавлен фильтр `v.google_sheet_row IS NOT NULL` — фантомы не дают бонусы. |
| `20260524180000_compute_manager_bonuses_drop_sheet_row_filter` | **Откат фильтра 20260524170000**: RPC снова считает по ВСЕМ `vacancies WHERE status='closed' AND closed_at ∈ period` без `google_sheet_row IS NOT NULL`. |
| `20260524190000_vacancies_priority` | `+priority TEXT CHECK IN ('высокий','средний','низкий')`, nullable. |
| `20260524200000_vacancies_google_sheet_row_unique_key` | **3 шага:** (1) cleanup 15 групп дублей `google_sheet_row` (старые → NULL = фантомы); (2) DROP UNIQUE `vacancies_hh_vacancy_id_key`; (3) CREATE UNIQUE INDEX `vacancies_google_sheet_row_idx` WHERE NOT NULL. Singular key для sheets-sync. |
| `20260524210000_drop_vacancies_title_manager_opened_unique` | DROP `uq_vacancies_title_manager_opened_no_hh` (мешал INSERT'ам новой модели). |

Типы `src/types/database.ts` синхронизированы (включая `priority`).

### API
- `dashboard/team`, `dashboard/manager`, `dashboard/me`, `dashboard/divisions`,
  `stats/politeness` — все принимают `?month=YYYY-MM` (MonthPicker).
  `team`/`manager`/`me` считают «Закрыто вакансий» через
  `vacancies WHERE status='closed' AND closed_at ∈ month` (**без** фильтра
  `google_sheet_row IS NOT NULL` — снят в коммите `87b8c77`, фантомы попадают).
- **«Активные вакансии»** на team/me/manager — фильтр `status='active' AND
  hh_vacancy_id IS NOT NULL` (вернулось в `87b8c77`; фантомы попадают, т.к.
  у них есть hh_id). НЕ путать с фильтром `google_sheet_row` — он применяется
  только в `/divisions` для подсчёта закрытых.
- `divisions` (коммит `3e85d56`) — фильтр `v.google_sheet_row !== null`
  **только** на 3 точках подсчёта закрытых (hiredByVacancy / closedInPeriod /
  cityAcc.closed). Active/funnel/cities.active фильтр НЕ применяется. SELECT
  включает `google_sheet_row`.
- `bonuses/` — RPC `compute_manager_bonuses` за текущий месяц. Источник =
  `vacancies WHERE status='closed' AND closed_at ∈ month` (**без** фильтра
  google_sheet_row — снят миграцией `20260524180000`). Fuzzy-match по
  `bonus_rates.position_name` vs `vacancies.title`, threshold 0.4. 61 тариф.
- **KPI «Звонки»** в `dashboard/team` берёт `SUM(calls_count) FROM vacancy_snapshots`
  (последний snapshot per vacancy, group by manager) — тот же источник, что
  и воронка в `divisions`. `daily_activities.{mango,hh}_calls_count` для KPI
  не используются (заполнялись вручную, почти всегда пустые).
- `stats/politeness` — фильтрует `politeness_index > 0` (нули = «нет данных»);
  также фильтр `user_profiles.is_active = false`.
- `sync/sheets/` — лист «Data» с тройным ключом дедупа, авто-создание
  пользователей из колонки «Менеджеры», новые статусы:
  - `закрыта` → `closed`
  - `стажировка` → `active` (стажёр идёт в hired_employees как `probation`)
  - `приостановлена` / `предзакрыта` → `paused`
- `sync/hh-csv/?type=vacancies` — НЕ создаёт фантомные вакансии. Записи без
  совпадающего `hh_vacancy_id` пропускаются (`rows_matched_no_vacancy`).
- `sync/hh-csv/?type=politeness_managers` — 5-уровневый матчер (id → exact →
  first_two_words → fuzzy → auto-create).
- **NEW:** `POST /api/sync/lock-period?month=YYYY-MM` (head/admin) — фиксирует
  `is_locked=true` всем snapshot'ам месяца. hh-csv с `stat_date` в прошлом
  проверяет locked-строки и пропускает (`rows_skipped_locked`).

### UI
- `/dashboard` — Tabs **«Сегодня / Неделя»** + **MonthPicker** (Select 13 опций:
  текущий + 12 прошлых). По умолчанию — текущий месяц.
  KPI-ряд: 5 карточек (Активных вакансий / Звонки / Собеседования / **Закрыто
  вакансий** / На стажировке). Карточка «Закрыто вакансий» без плана.
  Воронка из vacancy_snapshots: Отклики / Контакты / Приглашения / Звонки /
  Собеседования / Стажировка / **Закрыто вакансий**.
  Две карточки в ряд: «Укомплектованность компании» + «ИВ компании» (≥90 зелёный,
  ≥70 жёлтый, <70 красный; NULL → «—» + подсказка про CSV).
- `/dashboard/efficiency` — крайняя колонка «Бонус за месяц» (всегда текущий месяц).
  ИВ-карточка: 5 метрик включая 💰 Просмотры (поиск) / 💰 Приглашения из базы.
- `/dashboard/divisions` — раскрытая карточка с городами + «Закрыто вакансий
  за период».
- `/vacancies` — колонки «Город» (между «Подразделение» и «Менеджер»),
  **«Дней в работе»** (после «Открыта»: формат `«23 д.»`). **NEW в этой
  сессии:**
  - **Цвет числа «Дней в работе»** по эскалации (`priority` × `days`):
    низкий → серый без иконки; >30 дней → red + ⚠️; высокий + >14 → red + ⚠️;
    средний/null + >14 → amber + ⚠️.
  - **Клик-сортировка по любому заголовку** (Название / Подразделение / Город /
    Менеджер / Статус / Открыта / Дней в работе). Дефолт `opened_at` DESC,
    смена поля → asc, повторный клик → toggle. Сортируется текущая страница
    (20 строк), не весь набор. Стрелка `ChevronUp/Down` только на активном поле.
  - Название — `max-w-50 truncate` + native `title=` tooltip.
- `/bonuses` — таблица «Менеджер | Вакансия | Тариф | Сумма», группировка
  по менеджеру с sub-total и grand-total; «Тариф не задан» курсивом если
  fuzzy < 0.4.
- `/cabinet` — карточка «Мой бонус за месяц» (3 состояния: сумма / «Тариф не
  настроен» / 0 ₽).
- `/sync` — **NEW:** карточка «Зафиксировать месяц» (MonthPicker + Lock).
- `/sync/logs` — фильтр включает **«🔒 Фиксация периода»** (`source='lock-period'`).
- `/reset-password` — PKCE + implicit hash.

### Sync — особенности
- Sheets «HR_менеджеры» и Data — авто-создание `auth.users` через
  `lib/auto-provision.ts`. Идемпотентно через email-lookup.
- **Sheets дедуп вакансий = `google_sheet_row` (singular key, коммит `9f32f61`).**
  Двухшаговый UPDATE-then-INSERT (supabase-js не умеет ON CONFLICT с partial
  UNIQUE INDEX). Старые ключи дедупа (`hh_vacancy_id`, `(title, manager_id,
  opened_at)`) больше не используются.
- **Sheets-sync парсит:** «Приоритет» (`высокий`/`средний`/`низкий` → `priority`,
  всё иное → NULL) и «Месяц закрытия» (русское название месяца → последний день
  месяца 2026 как fallback для `closed_at`, если «Дата закрытия» пуста).
- Sheets headers с алиасами (location: «Населённый пункт» / «Город» / ...).
- HH-csv matcher для менеджеров: id → exact → first_two_words → fuzzy → auto-create.

---

## ⬜ Ожидающие задачи

### Прод-операции
1. **Vercel env vars** — должны быть:
   - `GOOGLE_SHEETS_VACANCIES_TAB = Data`
   - `GOOGLE_SHEETS_MANAGERS_TAB = HR_менеджеры`
   - `GOOGLE_SHEETS_BONUSES_TAB = Бонусы_HR`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (не `_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»** (см. блок
   «Что делать первым»). До этого май на дашборде = 0 закрытых.
3. **HH OAuth #22195** — ждём подтверждения партнёра. Cron-скрипты ждут.
4. **SMTP для `/reset-password`** — Supabase Dashboard → Auth → SMTP.
5. **Татьяна** — выдать пароль/доступ.

### Код — не начато
- **Cron-скрипты** (`scripts/sync-hh.ts` и т.п.) — отложено до HH OAuth.
- **Дроп `hr_bonuses`** — не используется, но не дропнута.
- **Удалить временные DEBUG-логи** в `hh-csv/route.ts` (строки 217, 249 —
  `console.log` про snapshot insert). Lint warning'и `no-console` уже горят.

### Из ревью 4.5 (необязательные)
- Middleware ролевых редиректов.
- `politeness_company` — не используется, можно почистить.

---

## ⚠️ Ключевые решения, отличающиеся от SPEC

1. Окно редактирования активностей — **30 дней** (не 7).
2. Статус KPI — **`'lagging'`** (не `'behind'`).
3. service-role в `/dashboard/team` и `/divisions` (RLS не пускает executive).
4. `hires_per_month` НЕ масштабируется — «Закрыто вакансий» всегда полный месяц.
5. HH CSV — основная архитектура, OAuth для будущего.
6. Google Sheets лист **«Data»** (не «Вакансии»).
7. `avg_response_hours` убран из UI.
8. `politeness_company` — weighted avg, **исключает `politeness_index = 0`**.
9. `/reset-password` без префикса `/auth/`.
10. PostgreSQL **17**.
11. Авто-создание `auth.users` при sync (Sheets HR_менеджеры + Data + hh-csv politeness).
12. «Бонусы_HR» — справочник тарифов, не журнал. 16 seed-тарифов в проде.
13. Стажировка — 7-й этап воронки (`hired_employees.status='probation'`, вакансия `active`).
14. Город `vacancies.location` — отдельная колонка.
15. Платные/бесплатные HH действия разделены в `hh_manager_stats`.
16. **Дедуп вакансий из Sheets — singular key `google_sheet_row`** (миграция
    `20260524200000`). Старые UNIQUE на `hh_vacancy_id` и
    `(title, manager_id, opened_at) WHERE hh_id IS NULL` сняты.
17. **«Закрыто вакансий» — всегда за полный текущий календарный месяц** во ВСЕХ
    API (`team`, `manager`, `me`, `divisions`). Источник = `vacancies.closed_at`.
18. **Sheets статусы:** `закрыта→closed`, `стажировка→active+probation`,
    `приостановлена`/`предзакрыта` → `paused`.
19. **Фильтры KPI после серии откатов** (актуально на 2026-05-25):
    - `team`/`me`/`manager` «Активные»: `status='active' AND hh_vacancy_id IS NOT NULL`
      (фантомы попадают — у них есть hh_id).
    - `team`/`me`/`manager` «Закрыто»: `status='closed' AND closed_at ∈ month`
      без доп. фильтра.
    - `divisions` «Закрыто за период»: те же условия + `google_sheet_row IS NOT NULL`
      (только в этом одном дашборде).
    - Бонусный RPC: без фильтра google_sheet_row (миграция `20260524180000`).
20. **Воронка дашборда** полностью из `vacancy_snapshots`:
    Отклики / **Контакты** = invitations_from_responses (бесплатно) /
    **Приглашения** = invitations_from_db (платно ⓟ) / Звонки = calls_count.
21. **KPI «Звонки»** на /dashboard берёт `SUM(calls_count)` из
    `vacancy_snapshots` (последний snapshot per vacancy) — тот же источник
    что и воронка. `daily_activities` для KPI не используется.
22. **MonthPicker** на `/dashboard`: Tabs «Сегодня/Неделя» + Select последних
    12 месяцев. API получают `?period=month&month=YYYY-MM`.
23. **Lock-period:** `vacancy_snapshots.is_locked`. POST `/api/sync/lock-period`
    фиксирует месяц; hh-csv с историческим `stat_date` пропускает locked.
24. **Бонусы:** RPC `compute_manager_bonuses` читает `vacancies.closed_at`
    (не `hired_employees`), threshold pg_trgm 0.4 (не 0.6). **Фильтр
    `google_sheet_row IS NOT NULL` снят** миграцией `20260524180000` — фантомы
    тоже дают бонусы. В каталоге `bonus_rates` 61 тариф (6 групп: Розница /
    Офис / Маркетинг / IT / Склад / B2B + алиасы).
25. **CSV-«фантомы»** (после cleanup'а — 129 вакансий: ~50 closed + ~66 active
    + 13 от cleanup'а дублей `google_sheet_row`). Все с `google_sheet_row IS NULL`,
    с `hh_vacancy_id`. Остатки откатанного hh-csv auto-create (commit `4c64f1c`
    → rollback `2243fbe`). **Оставлены в БД для аудита.** Сейчас попадают в
    KPI «Закрыто» / «Активные» на большинстве дашбордов (фильтр снят), кроме
    `divisions.closed_in_period` где остался.
26. **Колонка `vacancies.priority`** (миграция `20260524190000`) — nullable
    TEXT с CHECK in ('высокий','средний','низкий'). Заполняется sheets-sync'ом
    из колонки «Приоритет» листа Data. UI `/vacancies` использует для цветной
    эскалации в колонке «Дней в работе».

---

## 📝 Последние коммиты этой сессии (2026-05-25)

```
340cd76 fix(sheets): drop partial UNIQUE (title, manager_id, opened_at) → разблокировал sync
9f32f61 refactor(sheets): единственный ключ upsert = google_sheet_row
d4ca13c feat(vacancies): клиентская сортировка по клику на заголовок
3e85d56 fix(divisions): «Закрыто за период» = только из листа Data
6c80222 feat(vacancies): «Дней в работе» — цветной текст + ⚠️ по приоритету и сроку
7876ac9 feat(sheets): парсинг колонки «Приоритет» из листа Data → vacancies.priority
55c5ac4 feat(vacancies): priority indicator + truncate title
89f2b30 feat(sheets,bonuses): «Месяц закрытия» fallback + drop sheet_row filter в RPC
87b8c77 revert(dashboard): откат фильтра google_sheet_row IS NOT NULL (9731f19)
```

### Предыдущая сессия (2026-05-24)
```
ba3b1b3 fix(bonuses): exclude phantoms from compute_manager_bonuses RPC
9731f19 fix(dashboard): exclude phantoms via google_sheet_row IS NOT NULL
91ec824 feat(vacancies): «Дней в работе» — колонка в списке вакансий
3a2c8b4 fix: KPI «Звонки» source = vacancy_snapshots.calls_count (matches funnel)
1212bef chore: bonus_rates aliases + remove orphans (May bonus 174k→322k)
56d36b4 chore: full bonus_rates catalog from Бонусы_HR Sheet (58 positions)
384dfd5 feat(bonuses): source = vacancies.closed_at; group-by-manager UI
fd31a49 fix: «Закрыто вакансий» source = vacancies.closed_at (revert from snapshots)
6faf3cb fix: allow source='hh_csv' in vacancy_snapshots CHECK constraint
7790c97 feat: «Закрыто вакансий» — switch source to vacancy_snapshots.is_closed
c970271 docs: refresh HANDOFF — next session starts with vacancy_snapshots empty post-CSV
8efbbbf chore: hh-csv — log SNAPSHOT INSERT + capture insert error
322c26a feat: sheets sync — paused statuses (приостановлена/предзакрыта)
88c0318 feat: month picker on /dashboard + lock-period for historical data
b950a76 fix(divisions): «Закрыто за период» source = vacancies.closed_at
```

В working tree (некоммитнуто):
- `.gitignore` — старая правка пользователя (`+.vercel`, `+.env*`).
- `HANDOFF.md` / `PROJECT_IDEA.md` / `SPEC.md` — эта итерация документации.
