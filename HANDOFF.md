# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-23 (вечер)**.
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

Типы `src/types/database.ts` синхронизированы.

### API
- `dashboard/` (team, manager, divisions, me) — `divisions` теперь возвращает `cities[]` (разбивка по городам внутри подразделения).
- `bonuses/` — **полная переделка**: список считается на лету через RPC `compute_manager_bonuses`. Поля query: `manager_id?`, `year?`, `month?`. Старая `/bonuses/[id]/match` удалена.
- `stats/politeness/` — отдаёт `responses_viewed` (бесплатно), `resume_views_from_search`, `invitations_from_db` (платно ⓟ) и в company-aggregate.
- `sync/sheets/` — лист «Data» (вакансии) + «HR_менеджеры» (с автосозданием юзеров) + «Бонусы_HR» (справочник тарифов).
- `sync/hh-csv/` — 2 типа CSV (`politeness_managers`, `vacancies`). Матчер ФИО 4-уровневый: id → exact → first_two_words (Фамилия+Имя) → fuzzy фамилия.
- `admin/users/`, `staffing/`, `plans/`, `activities/`, `ai/*` — без изменений в этой сессии.

### UI
- `/dashboard` — две карточки в ряд: «Укомплектованность компании» + «Индекс вежливости компании» (цветовые пороги 90/70, NULL → «—» с подсказкой про CSV).
- `/dashboard/efficiency` — ИВ-карточка показывает 5 метрик: Откликов / Просмотры (отклики) / 💰 Просмотры (поиск) / 💰 Приглашения из базы / Отвечено.
- `/dashboard/divisions` — раскрытая карточка подразделения содержит блок «По городам».
- `/dashboard/manager` — 4 KPI карточки (звонки/собеседования/выведено/стажировка).
- `/vacancies` — добавлена колонка «Город» между «Подразделение» и «Менеджер».
- `/vacancies/[id]` — funnel с 7 этапами (включая «Стажировка»).
- `/bonuses` — одна карточка «Начислено за месяц», одна фильтр-Select, таблица «Менеджер | Вакансия | Должность | Сумма». Тариф не найден → «—».
- `/admin/users` — поле «Добавочный Манго» (есть давно, не трогал).
- `/reset-password` — есть (PKCE + implicit hash, redirect по роли).

### Sync — особенности
- **Sheets «HR_менеджеры»**: если ФИО не сматчилось в `user_profiles`, автоматически создаётся `auth.users` через `admin.createUser` (email из листа или fallback `<translit(ФИО)>@hr.local`, временный пароль `crypto.randomUUID()`, `email_confirm: true`). `user_profiles` материализуется триггером `handle_new_user`. Идемпотентно через предварительный lookup по email (ilike).
- **Sheets «Бонусы_HR»**: справочник тарифов «Должность → Стоимость». Upsert в `bonus_rates` по `position_name`. **Не** журнал начислений (старый smysl).
- **Sheets «Data»**: маппинг по заголовкам через `row.values[...]`, а не по `cells[N]` — устойчиво к перестановке колонок.
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
2. **Лист «Бонусы_HR»** — переформатировать как 2 колонки: `Должность` + `Стоимость` (рубли). Алиасы поддерживаются: `Позиция`/`Вакансия`/`Название`, `Сумма`/`Тариф`. Старая 5-колоночная схема перестала работать.
3. **HH OAuth #22195** — ждём подтверждения партнёра. До этого `scripts/sync-hh.ts` не пишем (см. ниже).
4. **SMTP для `/reset-password`** — Supabase Dashboard → Authentication → SMTP, подключить корпоративный (Yandex 360 / SendGrid). Шаблон письма — ссылка на `https://<host>/reset-password`.
5. **Татьяна** — выдать пароль / доступ. Либо завести через `/admin/users` (manager роль) и попросить пройти через `/reset-password`, либо вручную в Supabase Auth.

### Код — не начато
- **Cron-скрипты** (`scripts/sync-hh.ts`, `scripts/sync-mango.ts`, `scripts/refresh-hh-tokens.ts`, `scripts/generate-weekly-report.ts`) — отложено до HH OAuth.
- **Дроп `hr_bonuses`** — таблица не используется новой моделью бонусов, но не удалена (исторические данные + audit_logs). Отдельной миграцией если решишь снести.

### Из ревью 4.5 (необязательные)
- Middleware ролевых редиректов (сейчас защита в page-guard'ах).
- `politeness_company` — таблица не используется (агрегат считается на лету), можно почистить.

---

## ⚠️ Ключевые решения, отличающиеся от SPEC

1. **Окно редактирования активностей — 30 дней** (а не 7). Не откатывать.
2. **Статус KPI: `'lagging'`** (не `'behind'` из SPEC) для 70–89%.
3. **service-role в `/api/dashboard/team` и `/divisions`** — RLS иначе не пускает executive.
4. **`hires_per_month` масштабируется** по workdays периода (`scaledHiresPlan`).
5. **HH CSV — основная архитектура**, OAuth остаётся в `lib/hh-api.ts` для будущего near-real-time.
6. **Google Sheets лист «Data»** (не «Вакансии») — источник истины по вакансиям.
7. **`avg_response_hours`** убран из UI (поле БД остаётся nullable). Новый отчёт HH этой колонки не отдаёт.
8. **`politeness_company`** считается на лету как weighted average по менеджерам.
9. **`/reset-password`** живёт на `/reset-password` (не `/auth/reset-password`) — route group `(auth)` без префикса.
10. **PostgreSQL 17** (не 15 как было в раннем SPEC).
11. **Авто-создание `auth.users` при sync Sheets** — если ФИО менеджера нет в `user_profiles`. Расширяет trust boundary sheets-sync (head/admin триггерят creation). SPEC §5.6 это документирует.
12. **«Бонусы_HR» — справочник тарифов**, не журнал. Бонус считается на лету через `compute_manager_bonuses` (pg_trgm 0.6).
13. **Стажировка — 7-й этап воронки**: `hired_employees.status` ∈ {'hired','probation'}. Стажировка не закрывает вакансию (`vacancies.status` остаётся `'active'`).
14. **Город (`vacancies.location`)** — отдельная колонка; используется на `/vacancies` и в разбивке по городам внутри подразделения на `/dashboard/divisions`.
15. **Платные/бесплатные действия HH** разделены в `hh_manager_stats`: `responses_viewed` (бесплатно), `resume_views_from_search` + `invitations_from_db` (платно ⓟ). UI помечает платные значком 💰.

---

## 📝 Последние коммиты этой сессии

```
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
ab74470 fix: sheets sync — Data columns by header name, drop debug logs
96ec93c feat: probation stage in hiring funnel
```

Все запушены в `main`, Vercel задеплоил.

В working tree сейчас (некоммитнуто):
- `.gitignore` — старая правка пользователя (`+.vercel`, `+.env*`), её не трогал.
- `HANDOFF.md` — этот файл (закоммитить отдельно).
