# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-23 (поздний вечер)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## ✅ Что в проде сейчас

### Миграции (Supabase project `twfmfmkqfhclzvdogvix`)

Все ниже применены (проверено через `list_migrations` + `pg_proc`/`to_regclass`):

| Версия | Что добавляет |
|---|---|
| `20260522120000_initial_schema` | 14 таблиц, RLS, audit-триггеры, RPC `fuzzy_match_vacancy` / `find_vacancy_by_title`. |
| `20260523120000_fix_rls_write_policies` | Дроп широких `FOR ALL`, узкие head/admin write-политики, whitelist роли в `handle_new_user`. |
| `20260523123000_hh_vacancy_id_required_for_sheets` | (legacy, до перехода на лист «Data») |
| `20260523130000_audit_mask_hh_tokens` | Маска `hh_access_token` / `hh_refresh_token` в `audit_logs`. |
| `20260523140000_vacancy_snapshots_unique_per_day` | Разовая дедуп; UNIQUE INDEX не создаётся (идемпотентность держит `/api/sync/hh-csv` через DELETE+INSERT). |
| `20260523141000_hr_manager_syncs_hh_manager_id` | `+hh_manager_id TEXT` partial UNIQUE — стабильный матч HH↔БД. |
| `20260523150000_vacancies_sheets_fields` | `+location` / `customer_name` / `positions_count`. |
| `20260523160000_hired_employees_probation_status` | `+status` ('hired'/'probation') — стажировка как промежуточный этап воронки. |
| `20260523170000_cleanup_header_rows_in_managers` | Удаление фантомных `'HR менеджеры'` / `'Нг менеджеры'` (омоглиф) из `hr_manager_syncs` + `auth.users` + `user_profiles`. |
| `20260523180000_bonus_rates` | Таблица `bonus_rates` (position_name UNIQUE, amount_kopecks) + GIN trigram index + RLS + RPC `compute_manager_bonuses(date, date, uuid?, float=0.6)`. |
| `20260523190000_hh_manager_stats_paid_columns` | `+resume_views_from_search` / `+invitations_from_db` (платные действия HH, nullable). |
| `20260523200000_bonus_rates_group_name` | `+group_name TEXT` в `bonus_rates` (Розница / Офис / …) — для группировки тарифов в UI. |
| `20260523210000_seed_bonus_rates` | Идемпотентный seed 16 стартовых тарифов (Розница 9 шт., Офис 7 шт.). `ON CONFLICT (position_name) DO NOTHING` — не перетирает значения из листа. |
| `20260523220000_vacancies_unique_title_manager_opened` | Partial UNIQUE INDEX `(manager_id, title, opened_at) WHERE hh_vacancy_id IS NULL` — больше две одноименные вакансии у одного менеджера в разные даты не схлопываются. |

Типы `src/types/database.ts` синхронизированы.

### API
- `dashboard/team`, `dashboard/manager`, `dashboard/me` — KPI «Выведено» **всегда за полный текущий календарный месяц** через `vacancies WHERE status='closed' AND closed_at ∈ month`. План = `hires_per_month` без масштабирования. «Активные вакансии» — без даты (как было).
- `dashboard/divisions` — оставлен с собственным period selector (week/month/quarter), отдаёт `cities[]` (разбивка по городам внутри подразделения).
- `bonuses/` — список и summary считаются через RPC `compute_manager_bonuses` за текущий месяц. Старая `/bonuses/[id]/match` удалена.
- `stats/politeness/` — отдаёт `responses_viewed` (бесплатно), `resume_views_from_search`, `invitations_from_db` (платно ⓟ) per-manager и в company-aggregate.
- `sync/sheets/` — лист «Data» (вакансии) + «HR_менеджеры» (с автосозданием юзеров) + «Бонусы_HR» (справочник тарифов).
- `sync/hh-csv/` — 2 типа CSV (`politeness_managers`, `vacancies`). Матчер ФИО 4-уровневый: id → exact → first_two_words (Фамилия+Имя) → fuzzy фамилия.
- Новый хелпер `lib/api-helpers.ts:currentMonthRange()` — единая точка истины для месячного окна.

### UI
- `/dashboard` — KPI-ряд из **5 карточек**: «Активных вакансий» (Briefcase, без плана) → «Звонки» → «Собеседования» → «Выведено» → «На стажировке». Под ним две карточки в ряд: «Укомплектованность компании» + «Индекс вежливости компании» (пороги 90/70).
- `/dashboard/efficiency` — крайняя справа колонка «Бонус за месяц» (всегда календарный месяц, зелёный > 0, серый «—» иначе). ИВ-карточка показывает 5 метрик: Откликов / Просмотры (отклики) / 💰 Просмотры (поиск) / 💰 Приглашения из базы / Отвечено.
- `/dashboard/divisions` — раскрытая карточка подразделения содержит блок «По городам».
- `/dashboard/manager` — 4 KPI карточки (звонки/собеседования/выведено/стажировка); «Выведено» теперь всегда за месяц.
- `/vacancies` — колонка «Город» между «Подразделение» и «Менеджер».
- `/vacancies/[id]` — funnel с 7 этапами (включая «Стажировка»).
- `/bonuses` — подзаголовок «Май 2026» (текущий месяц на русском), карточка «Начислено за месяц», таблица «Менеджер | Вакансия | Тариф | Сумма». Тариф не найден → курсивом «Тариф не задан», такая строка не суммируется.
- `/cabinet` — новая карточка `MyBonusCard` между KpiBar и алертом про звонки: «Мой бонус за месяц» с подписью «за {Май 2026}». Три состояния: сумма (зелёным), «Тариф не настроен» (серым), «0 ₽» (серым).
- `/admin/users` — поле «Добавочный Манго» (есть давно, не трогал).
- `/reset-password` — есть (PKCE + implicit hash, redirect по роли).

### Sync — особенности
- **Sheets «HR_менеджеры»**: если ФИО не сматчилось в `user_profiles`, автоматически создаётся `auth.users` через `admin.createUser` (email из листа или fallback `<translit(ФИО)>@hr.local`, временный пароль `crypto.randomUUID()`, `email_confirm: true`). `user_profiles` материализуется триггером `handle_new_user`. Идемпотентно через предварительный lookup по email (ilike).
- **Sheets «Data» — авто-создание из колонки «Менеджеры»**: тот же механизм применяется к ФИО из строки вакансии. Раньше строки с незнакомым менеджером тихо пропускались; теперь юзер создаётся, кэш `profileByNormName` обновляется на лету, строка обрабатывается дальше. `created_users` в ответе sync теперь включает обоих источников.
- **Sheets «Data» — дедуп вакансий**: ключ для строк без `hh_vacancy_id` теперь `(title, manager_id, opened_at)` — три поля. БД-уровень держит partial UNIQUE INDEX (миграция 22000). Если `openedAt` пуст — всегда INSERT (дедупа нет). Решает баг: «Менеджер по продажам / Анисимова Диана» в январе и апреле больше не схлопывается.
- **Sheets «Бонусы_HR»**: справочник тарифов «Должность → Стоимость». Upsert в `bonus_rates` по `position_name`. **Не** журнал начислений.
- **Sheets «Data» — заголовок города**: location читается с алиасами (`Населённый пункт` / `Населенный пункт` / `Город` / `Местоположение`) — устойчиво к написанию в листе.
- **HH CSV**: матчер `first_two_words` ловит «Анисимова Диана Витальевна» (HH) ↔ «Анисимова Диана» (Sheets). Платные действия (поиск + база) парсятся по подстрокам «Просмотры резюме из поиска» и «Приглашений из базы».

---

## ⬜ Ожидающие задачи

### Прод-операции на стороне пользователя
1. **Vercel env vars** — убедиться что выставлены актуальные значения:
   - `GOOGLE_SHEETS_VACANCIES_TAB = Data`
   - `GOOGLE_SHEETS_MANAGERS_TAB = HR_менеджеры`
   - `GOOGLE_SHEETS_BONUSES_TAB = Бонусы_HR`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (не `_KEY`)
   - `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. **Лист «Бонусы_HR»** — переформатировать как 2 колонки: `Должность` + `Стоимость` (рубли). Алиасы поддерживаются: `Позиция`/`Вакансия`/`Название`, `Сумма`/`Тариф`. Сейчас на проде уже работают 16 seed-тарифов (`Розница` 9 шт., `Офис` 7 шт.) — лист дополняет/перетирает их по `position_name`.
3. **CSV из HH** — ни один CSV не загружен (`vacancy_snapshots = 0`), поэтому воронка отдела на `/dashboard` (Отклики/Контакты/Приглашения) пуста. Загрузить через `/sync`:
   - «Аналитика вакансий» (`recruitment_analytics_vacancies_*.csv`) → `vacancy_snapshots` + EC-03.
   - «Статистика менеджеров» (`recruitment_analytics_managers_statistics_*.csv`) — уже 5 строк, но `responses_received` сумма = 0; парсер не находит колонку «Отклики» — проверить точное название.
4. **Активности менеджеров** (`daily_activities = 0`) — пока ни звонков, ни собеседований нет. Либо менеджерам вносить вручную в `/cabinet`, либо ждать cron Манго/HH.
5. **HH OAuth #22195** — ждём подтверждения партнёра. До этого `scripts/sync-hh.ts` не пишем (см. ниже).
6. **SMTP для `/reset-password`** — Supabase Dashboard → Authentication → SMTP, подключить корпоративный (Yandex 360 / SendGrid). Шаблон письма — ссылка на `https://<host>/reset-password`.
7. **Татьяна** — выдать пароль / доступ. Либо завести через `/admin/users` (manager роль) и попросить пройти через `/reset-password`, либо вручную в Supabase Auth.

### Код — не начато
- **Cron-скрипты** (`scripts/sync-hh.ts`, `scripts/sync-mango.ts`, `scripts/refresh-hh-tokens.ts`, `scripts/generate-weekly-report.ts`) — отложено до HH OAuth.
- **Дроп `hr_bonuses`** — таблица не используется новой моделью бонусов, но не удалена (исторические данные + audit_logs). Отдельной миграцией если решишь снести.
- **Удалить временные DEBUG-логи** в `src/app/api/sync/sheets/route.ts` (`SYNC RESULT:`, `DEBUG processing row:`, `DEBUG skip ...`, `DEBUG profileByNormName keys:`) — после того как диагностика sheets-sync завершится.

### Из ревью 4.5 (необязательные)
- Middleware ролевых редиректов (сейчас защита в page-guard'ах).
- `politeness_company` — таблица не используется (агрегат считается на лету), можно почистить.

---

## ⚠️ Ключевые решения, отличающиеся от SPEC

1. **Окно редактирования активностей — 30 дней** (а не 7). Не откатывать.
2. **Статус KPI: `'lagging'`** (не `'behind'` из SPEC) для 70–89%.
3. **service-role в `/api/dashboard/team` и `/divisions`** — RLS иначе не пускает executive.
4. **`hires_per_month` НЕ масштабируется** — KPI «Выведено» теперь всегда меряется в полном текущем месяце; `scaledHiresPlan` отключён в team/manager/me (но функция в `lib/api-helpers` оставлена на всякий случай).
5. **HH CSV — основная архитектура**, OAuth остаётся в `lib/hh-api.ts` для будущего near-real-time.
6. **Google Sheets лист «Data»** (не «Вакансии») — источник истины по вакансиям.
7. **`avg_response_hours`** убран из UI (поле БД остаётся nullable). Новый отчёт HH этой колонки не отдаёт.
8. **`politeness_company`** считается на лету как weighted average по менеджерам.
9. **`/reset-password`** живёт на `/reset-password` (не `/auth/reset-password`) — route group `(auth)` без префикса.
10. **PostgreSQL 17** (не 15 как было в раннем SPEC).
11. **Авто-создание `auth.users` при sync Sheets** — если ФИО менеджера нет в `user_profiles`. Срабатывает И в листе «HR_менеджеры», И в строке Data (колонка «Менеджеры»). SPEC §5.6 это документирует.
12. **«Бонусы_HR» — справочник тарифов**, не журнал. Бонус считается на лету через `compute_manager_bonuses` (pg_trgm 0.6). 16 стартовых тарифов поселены через `20260523210000_seed_bonus_rates`.
13. **Стажировка — 7-й этап воронки**: `hired_employees.status` ∈ {'hired','probation'}. Стажировка не закрывает вакансию (`vacancies.status` остаётся `'active'`).
14. **Город (`vacancies.location`)** — отдельная колонка; используется на `/vacancies` и в разбивке по городам внутри подразделения на `/dashboard/divisions`. Парсер sheets читает с алиасами.
15. **Платные/бесплатные действия HH** разделены в `hh_manager_stats`: `responses_viewed` (бесплатно), `resume_views_from_search` + `invitations_from_db` (платно ⓟ). UI помечает платные значком 💰.
16. **Дедуп вакансий из Sheets** — без `hh_vacancy_id` ключ `(title, manager_id, opened_at)`. Без `opened_at` всегда INSERT (дедуп невозможен).
17. **KPI «Выведено» — всегда за полный текущий календарный месяц** во всех `/dashboard/*` API (`team`, `manager`, `me`). Период страницы (today/week/month) на эту метрику не влияет. Карточка `/cabinet` `MyBonusCard` следует тому же правилу через `/api/bonuses`.

---

## 📝 Последние коммиты этой сессии

```
7f37df2 fix: «Выведено» counter — always current month via vacancies.closed_at
8cc1e74 fix: sheets sync — dedupe vacancies by (title, manager_id, opened_at)
4600be3 feat: per-manager «Бонус за месяц» on /dashboard/efficiency and /cabinet
e2c5441 feat: sheets sync — auto-create users for unknown managers in Data rows
c51b3cb chore: temp SYNC RESULT log after Data loop
11baafa feat: /bonuses — month header + Tariff column + seed default rates
cb89e0a feat: /dashboard — «Активных вакансий» KPI card first in the row
6d2313c fix: sheets sync — try multiple header aliases for location
89cf9d3 docs: refresh HANDOFF with current state after bonus_rates + paid HH split
69ace72 feat: split HH paid/free resume views and invitations in stats
cbbdd6a feat: /dashboard — rename staffing to «компании» + add company politeness card
19025a2 feat: /vacancies — add «Город» column between subdivision and manager
d70d89c feat(bonuses): rewrite as rate-sheet × hired_employees with fuzzy match
7c98274 feat: /bonuses — simplify to one summary card and one filter
c7c7ae7 feat: /dashboard/divisions — city breakdown inside each subdivision
c349743 feat: hh-csv match by first two words (Фамилия + Имя)
9ae3d2e fix: filter header-like manager rows + stronger email dedup
e91cf23 docs: document auto user provisioning in HR managers sheet sync
3364782 feat: auto-create auth users for managers from Sheets sync
```

Все запушены в `main`, Vercel задеплоил.

В working tree (некоммитнуто):
- `.gitignore` — старая правка пользователя (`+.vercel`, `+.env*`), её не трогал.
- `HANDOFF.md`, `PROJECT_IDEA.md`, `SPEC.md` — обновляются этим коммитом.
