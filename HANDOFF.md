# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-24 (поздний вечер)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🔥 Что делать первым в следующей сессии

**Текущее состояние:** воронка вакансий ожила, бонусы переключены на `vacancies`,
KPI «Звонки» взяты из тех же snapshots что и воронка, фантомы (116 строк, остатки
откатанного hh-csv auto-create — см. ниже) изолированы фильтром `google_sheet_row
IS NOT NULL` во всех KPI-дашбордах и в бонусном RPC. **Удалять фантомов из БД
НЕ НАДО** (пользователь решил оставить для аудита).

**Что ждёт пользователя (внешняя работа, не код):**

1. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data» вручную**
   (список выгружен в последней сессии: `title + hh_vacancy_id + closed_at`).
   После добавления + sheets-sync им проставится `google_sheet_row` и они
   автоматически появятся в KPI «Закрыто вакансий» + бонусах за май. **Сейчас
   май показывает 0 закрытых** — это корректно, реально в листе Data за май пусто.
2. **Проверить 2 строки с латинскими омоглифами в названии** перед добавлением
   в Sheets: `132437096` (Cпециалист — латинская C), `132436528` (удaлeннo —
   латинские a/e/n/o), `131824921` (YАMAGUCHI — кириллическая А). Иначе
   fuzzy-match по `bonus_rates` снова не сработает.

**Возможная следующая код-задача (не обязательно):** если после загрузки в Sheets
обнаружатся новые позиции вне каталога тарифов (например, «Руководитель филиала»,
«Территориальный директор», «Старший логист-кладовщик») — добавить их в
`bonus_rates` через миграцию-`INSERT ... ON CONFLICT DO UPDATE` по образцу
`20260524150000_bonus_rates_aliases_cleanup.sql`.

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

Типы `src/types/database.ts` синхронизированы.

### API
- `dashboard/team`, `dashboard/manager`, `dashboard/me`, `dashboard/divisions`,
  `stats/politeness` — все принимают `?month=YYYY-MM` (MonthPicker).
  `team`/`manager`/`me` считают «Закрыто вакансий» через
  `vacancies WHERE status='closed' AND closed_at ∈ month AND google_sheet_row IS NOT NULL`.
  План «Закрыто вакансий» на /dashboard скрыт (sum-of-defaults давал 300).
- **«Активные вакансии»** на всех дашбордах фильтруются
  `status='active' AND google_sheet_row IS NOT NULL` (вместо старого
  `hh_vacancy_id IS NOT NULL` — он не отсеивал фантомов: у фантомов есть hh_id).
- `divisions` — фильтр `.not('google_sheet_row', 'is', null)` на исходном
  SELECT vacancies → фильтрует все подразделенческие агрегаты (active /
  closed_in_period / cities / funnel).
- `bonuses/` — RPC `compute_manager_bonuses` за текущий месяц.
  Источник = `vacancies WHERE status='closed' AND closed_at ∈ month AND
  google_sheet_row IS NOT NULL`. Fuzzy-match по `bonus_rates.position_name`
  vs `vacancies.title`, threshold 0.4. 61 тариф в каталоге.
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
- `/vacancies` — колонки «Город» (между «Подразделение» и «Менеджер») и
  **«Дней в работе»** (после «Открыта»): активные `today − opened_at`,
  закрытые `closed_at − opened_at`, формат `«23 д.»`.
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
- Sheets дедуп вакансий по `(title, manager_id, opened_at)` с partial UNIQUE INDEX.
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
16. Дедуп вакансий из Sheets — ключ `(title, manager_id, opened_at)`.
17. **«Закрыто вакансий» — всегда за полный текущий календарный месяц** во ВСЕХ
    API (`team`, `manager`, `me`, `divisions`). Источник = `vacancies.closed_at`.
18. **Sheets статусы:** `закрыта→closed`, `стажировка→active+probation`,
    `приостановлена`/`предзакрыта` → `paused`.
19. **«Активные вакансии»** и **«Закрыто вакансий»** на ВСЕХ дашбордах
    (`team`/`me`/`manager`/`divisions`) фильтруются `google_sheet_row IS NOT NULL`
    — единый признак «реальная вакансия из листа Data». Раньше фильтр был по
    `hh_vacancy_id IS NOT NULL`, но он не отсеивал CSV-фантомов (у них hh_id
    есть, нет только `google_sheet_row`). Бонусный RPC использует тот же фильтр.
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
    (не `hired_employees`), threshold pg_trgm 0.4 (не 0.6), filter
    `google_sheet_row IS NOT NULL` (исключает фантомов). В каталоге `bonus_rates`
    61 тариф (6 групп: Розница / Офис / Маркетинг / IT / Склад / B2B + алиасы).
25. **CSV-«фантомы»** (116 вакансий: 50 closed + 66 active без google_sheet_row,
    но с hh_vacancy_id) — остатки откатанного hh-csv auto-create (commit
    `4c64f1c` → rollback `2243fbe`). **Оставлены в БД для аудита**, но
    исключены из всех KPI через `google_sheet_row IS NOT NULL`.

---

## 📝 Последние коммиты этой сессии

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
