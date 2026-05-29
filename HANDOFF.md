# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-29**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🔥 Что делать первым в следующей сессии

**Главное изменение этой сессии — полный фичер «Заявки на вакансию» + «Онбординг через XLSX».**

Фичи задеплоены и закоммичены. Основные вещи, которые ждут проверки и внешней работы:

1. **Протестировать загрузку XLSX на `/onboarding`.** Только для `admin`.
   Шаблон скачивается там же кнопкой «Скачать шаблон». Проверить все 4 листа:
   список HR, вакансии, бонусные тарифы, план укомплектованности.
   Ошибка `hr_manager_syncs duplicate hh_manager_id` — **исправлена** (`41d56f2`):
   дублирование по HH ID теперь корректно определяется как update.

2. **Протестировать `/requests` (Заявки на вакансию).**
   - manager создаёт черновик → head/admin/executive согласовывают → manager активирует.
   - Открытая вакансия при активации требует `hh_vacancy_id`.
   - Конфиденциальная — генерирует `internal_ref = CONF-2026-NNNN` автоматически.
   - Executive **не может** согласовать собственную заявку (guard на уровне RLS + API).

3. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»** (актуально
   из прошлой сессии). После sheets-sync они появятся в KPI и бонусах.

4. **Добавить колонку «Приоритет» в лист Data** (`высокий`/`средний`/`низкий`),
   если ещё не добавлено. Парсер уже умеет, UI уже отображает.

**Ближайшие код-задачи (не начаты):**
- `hh-csv/route.ts` — удалить `console.log` отладочные строки (лент no-console).
- Cron-скрипты отложены до HH OAuth.

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
| `20260524200000_vacancies_google_sheet_row_unique_key` | **3 шага:** (1) cleanup 15 групп дублей `google_sheet_row`; (2) DROP UNIQUE `vacancies_hh_vacancy_id_key`; (3) CREATE UNIQUE INDEX `vacancies_google_sheet_row_idx` WHERE NOT NULL. |
| `20260524210000_drop_vacancies_title_manager_opened_unique` | DROP `uq_vacancies_title_manager_opened_no_hh` (мешал INSERT'ам новой модели). |
| `20260528010000_template_uploads_preview_data` | Таблица `template_uploads` + `preview_data JSONB` + RLS (head/admin). |
| `20260529000000_vacancy_request` | `vacancies`: +`request_reason/status/requested_by/approved_by/approved_at/rejection_reason/confidentiality/internal_ref`. RPC `gen_internal_ref()` (атомарный `nextval(conf_vacancy_seq)`). Триггер `enforce_request_approval`: draft→active без approved — EXCEPTION (только для заявочного флоу: `OLD.requested_by IS NOT NULL`). RLS: `vacancies_request_insert`, `vacancies_draft_author_update`, `vacancies_request_approve` (guard `auth.uid() IS DISTINCT FROM requested_by`). |
| `20260529010000_vacancy_request_fixes` | RLS `vacancies_request_approve`: добавлен guard `auth.uid() IS DISTINCT FROM requested_by`. Триггер: блокировка только при `OLD.requested_by IS NOT NULL`. |
| `20260529020000_hr_manager_syncs_hh_id_full_index` | Полный индекс на `hr_manager_syncs.hh_manager_id` (не partial) для lookup в diff-builder. |

Типы `src/types/database.ts` синхронизированы (включая `priority`, `confidentiality`, `request_*`).

### API
- `dashboard/team`, `dashboard/manager`, `dashboard/me`, `dashboard/divisions`,
  `stats/politeness` — все принимают `?month=YYYY-MM` (MonthPicker).
  `team`/`manager`/`me` считают «Закрыто вакансий» через
  `vacancies WHERE status='closed' AND closed_at ∈ month` (**без** фильтра
  `google_sheet_row IS NOT NULL` — снят в коммите `87b8c77`, фантомы попадают).
- **«Активные вакансии»** на team/me/manager — фильтр `status='active' AND
  hh_vacancy_id IS NOT NULL` (фантомы попадают — у них есть hh_id). НЕ путать
  с фильтром `google_sheet_row` — он применяется только в `/divisions`.
- `divisions` — фильтр `v.google_sheet_row !== null || v.internal_ref !== null || v.requested_by !== null`
  на закрытых. После добавления заявочного флоу критерий расширен (`b3897de`):
  активированные заявки и конфиденциальные вакансии теперь попадают в дашборд.
- `bonuses/` — RPC `compute_manager_bonuses`, источник = `vacancies WHERE status='closed'
  AND closed_at ∈ month`, fuzzy-match threshold 0.4. 61 тариф (6 групп).
- **KPI «Звонки»** — `SUM(calls_count) FROM vacancy_snapshots` (последний snapshot per vacancy).
  `daily_activities` для KPI не используется.
- `stats/politeness` — фильтр `politeness_index > 0` и `is_active = false`.
- `sync/sheets/` — дедуп по `google_sheet_row`, авто-создание пользователей.
- `sync/hh-csv/?type=vacancies|politeness_managers` — без auto-create фантомов.
- `POST /api/sync/lock-period?month=YYYY-MM` (head/admin) — фиксирует `is_locked`.
- **NEW: Заявки на вакансию:**
  - `POST /api/vacancies/requests` — создание черновика (любой авторизованный).
  - `PATCH /api/vacancies/requests/[id]/approve` — согласование (head/admin/executive,
    нельзя одобрить собственную — guard на RLS + API).
  - `PATCH /api/vacancies/requests/[id]/reject` — отклонение с причиной.
  - `PATCH /api/vacancies/requests/[id]/activate` — активация: открытая требует
    `hh_vacancy_id`; конфиденциальная — автогенерация `CONF-2026-NNNN` через
    RPC `gen_internal_ref()`.
  - `GET /api/vacancies?request_status=pending|approved|rejected` — фильтр заявок.
- **NEW: Онбординг XLSX:**
  - `GET /api/templates/[type]/download` — скачать пустой шаблон.
  - `POST /api/templates/upload` — парсинг + preview diff (SHA-256 idempotency).
  - `POST /api/templates/upload/[id]/apply` — запись в БД через service_role.
  - `GET /api/templates/upload/[id]/error-report` — XLSX-отчёт об ошибках.

### UI
- `/dashboard` — Tabs **«Сегодня / Неделя»** + **MonthPicker** (Select 13 опций).
  KPI-ряд: 5 карточек. Воронка из vacancy_snapshots.
- `/dashboard/efficiency` — колонка «Бонус за месяц», ИВ-карточка с платными метриками.
- `/dashboard/divisions` — карточка с городами + «Закрыто за период».
- `/vacancies` — колонки «Город», «Дней в работе» (цвет по эскалации + ⚠️),
  клик-сортировка по заголовкам, truncate названия с tooltip.
- `/bonuses` — группировка по менеджеру, sub-total, grand-total.
- `/cabinet` — карточка «Мой бонус за месяц».
- `/sync` — карточка «Зафиксировать месяц».
- `/reset-password` — PKCE + implicit hash.
- **NEW `/requests`** — список заявок (табы pending/approved/rejected для всех ролей).
  `VacancyRequestForm` — модалка создания со `StaffingCheckWidget`.
  `ApprovalActions` — согласование/отклонение.
  `ActivateModal` — активация (открытая: ввод HH ID; конфиденциальная: auto-ref).
- **NEW `/onboarding`** — только `admin`. 3-шаговый мастер (prepare → preview → done).
  `TemplateDownloadCard` — скачивание 5 шаблонов (combined + по типу).
  `TemplateUploadZone` — drag-n-drop XLSX.
  `DiffPreviewTable` — предпросмотр insert/update/skip/error по листам.
  `ErrorRowList` — список пропущенных строк с причинами.

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
2. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»**. До этого май = 0 закрытых.
3. **HH OAuth #22195** — ждём подтверждения партнёра. Cron-скрипты ждут.
4. **SMTP для `/reset-password`** — Supabase Dashboard → Auth → SMTP.
5. **Татьяна** — выдать пароль/доступ.

### Код — не начато
- **Cron-скрипты** (`scripts/sync-hh.ts` и т.п.) — отложено до HH OAuth.
- **Дроп `hr_bonuses`** — не используется, но не дропнута.
- **Удалить DEBUG-логи** в `hh-csv/route.ts` (`console.log` про snapshot insert) — lint `no-console` горит.

### Из ревью (необязательные)
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
25. **CSV-«фантомы»** (после cleanup'а — 129 вакансий). Все с `google_sheet_row IS NULL`.
    Оставлены в БД для аудита. Попадают в KPI на большинстве дашбордов (фильтр снят),
    кроме `divisions.closed_in_period`.
26. **Колонка `vacancies.priority`** — nullable TEXT CHECK. Заполняется sheets-sync'ом.
    UI `/vacancies` использует для цветной эскалации «Дней в работе».
27. **Заявки на вакансию** (`vacancies.request_status`): `draft → approved → active`
    или `draft → rejected`. Конфиденциальные — без публикации на HH, только
    `internal_ref = CONF-2026-NNNN` (RPC `gen_internal_ref()`, атомарный sequence).
    Триггер `enforce_request_approval` защищает от прямого draft→active в обход flow,
    но только для заявочных строк (`requested_by IS NOT NULL`).
28. **`divisions` фильтр «из листа»** расширен с `google_sheet_row IS NOT NULL` до
    `(google_sheet_row IS NOT NULL OR internal_ref IS NOT NULL OR requested_by IS NOT NULL)`.
    Активированные заявки и конфиденциальные теперь учитываются.
29. **Онбординг XLSX** — `/onboarding` (только admin). 4 листа в одном файле:
    «Список HR» → `hr_manager_syncs` + `user_profiles`; «Вакансии» → `vacancies`;
    «Бонусные тарифы» → `bonus_rates`; «План укомплектованности» → `staffing_records`.
    Дедуп `hr_manager_syncs` по `sheet_full_name` ИЛИ `hh_manager_id` (фикс `41d56f2`).

---

## 📝 Последние коммиты (2026-05-29)

```
41d56f2 fix(onboarding): hr_manager_syncs duplicate hh_manager_id on XLSX upload
86fc931 fix: hr_manager_syncs ignore duplicates  (← откат к insert, был неправильным)
ccbfe96 fix: hr_manager_syncs ignoreDuplicates   (← первая попытка upsert)
287f1ed fix(vacancy-request): адресуем should-fix из code review
f87936f fix(staffing): адресуем should-fix и nit из code review
b3897de feat(ui): /requests + API заявок на вакансию + SPEC_RECONCILIATION §2 divisions
4f10ffa feat(db): vacancy_request migration + gen_internal_ref RPC + enforce_request_approval trigger
5a2016f fix(templates): must-fix/should-fix из code review (batch insert, parseInt, retry 23505)
c13b7df feat(ui): /onboarding — 3-шаговый мастер (prepare → preview → done)
f6feda5 feat(templates): Блок 2 API — lib/templates/* + /api/templates/* endpoints
```

### Предыдущая сессия (2026-05-25)
```
340cd76 fix(sheets): drop partial UNIQUE → разблокировал sync
9f32f61 refactor(sheets): единственный ключ upsert = google_sheet_row
d4ca13c feat(vacancies): клиентская сортировка по заголовкам
3e85d56 fix(divisions): «Закрыто за период» = только из листа Data
6c80222 feat(vacancies): «Дней в работе» — цвет + ⚠️ по приоритету
7876ac9 feat(sheets): парсинг колонки «Приоритет»
87b8c77 revert(dashboard): откат фильтра google_sheet_row IS NOT NULL
```

Working tree чистый.
