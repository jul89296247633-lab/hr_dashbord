# HANDOFF — HR Control Tower

> Сводка состояния проекта для передачи сессии. Дата: 2026-05-23.
> Источник истины по требованиям — `SPEC.md`. Правила — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui (вручную), Supabase (PG17), Zod.

Проверка после изменений: `npx tsc --noEmit`, `npx next lint`, `next build` — **все три зелёные**.
(Сборка прогоняется с фиктивными env: `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.)

---

## ✅ Что сделано

### Data Model + миграции
Прод применены / готовы к применению (`supabase db push`):

| # | Файл | Назначение |
|---|---|---|
| 1 | `20260522120000_initial_schema.sql` | 14 таблиц, RLS на всех, audit-триггеры, RPC `fuzzy_match_vacancy`. |
| 2 | `20260523120000_fix_rls_write_policies.sql` | Дроп широких `FOR ALL WITH CHECK(TRUE)`, узкие head/admin write-политики; whitelist роли в `handle_new_user`. |
| 3 | `20260523123000_hh_vacancy_id_required_for_sheets.sql` | Контракт: `hh_vacancy_id` для sheets-sync (старая логика, до перехода на лист «Data»). |
| 4 | `20260523130000_audit_mask_hh_tokens.sql` | Маскировка `hh_access_token`/`hh_refresh_token` в `audit_logs` + чистка существующих записей. |
| 5 | `20260523140000_vacancy_snapshots_unique_per_day.sql` | Разовая дедупликация `vacancy_snapshots` по `(vacancy_id, DATE(snapshot_at))`. UNIQUE INDEX **не** создаётся — идемпотентность держит роут `/api/sync/hh-csv` через DELETE+INSERT. |
| 6 | `20260523141000_hr_manager_syncs_hh_manager_id.sql` | `+hh_manager_id TEXT` (nullable) + partial UNIQUE. Стабильный матч менеджеров HH↔БД. |
| 7 | `20260523150000_vacancies_sheets_fields.sql` | `+location/customer_name/positions_count` в `vacancies` под новую схему листа «Data». |

Типы `src/types/database.ts` синхронизированы со всеми миграциями.

### API (`src/app/api/`) — 36 route-файлов
- `activities/` (GET/POST за 30 дней), `vacancies/` (CRUD + funnel), `dashboard/` (team/manager/me/divisions),
  `plans/`, `staffing/`, `bonuses/`, `stats/politeness/`, `ai/`, `admin/` (users/audit/error-logs/integrations).
- Хелперы: `lib/api-helpers.ts` (getAuthUser/requireRole/handleApiError/scaledHiresPlan), `lib/supabase/*`,
  `lib/validations.ts`, `lib/google-sheets.ts`, `lib/hh-csv-parser.ts`, `lib/hh-api.ts`, `lib/mango.ts`, `lib/ai/*`.

### Sync-стек (полностью обновлён под CSV-выгрузки HH 2026-05)
- **`/api/sync/sheets`** — переписан под лист **«Data»** (бывший «Вакансии»):
  - Колонки A..R листа (см. шапку route) → `vacancies` (upsert ВСЕ строки).
  - Закрытые (колонка N = `Закрыта`) → дополнительно в `hired_employees`.
  - Upsert ключ: `hh_vacancy_id` если заполнен, иначе `(title, manager_id)`.
  - Несколько менеджеров через `,;` → берём первого.
  - `manager_id` не найден в `user_profiles.full_name` → пропуск + `skipped_no_manager_rows` в ответе.
- **`/api/sync/hh-csv`** — два типа CSV вместо трёх:
  - `politeness_managers` → `recruitment_analytics_managers_statistics_*.csv` → `hh_manager_stats`.
  - `vacancies` → `recruitment_analytics_vacancies_*.csv` → `vacancy_snapshots` + EC-03 (`Архивная=Да` → `vacancies.status='closed'`).
  - Матчер менеджеров: (1) `hh_manager_id` точный, (2) ФИО exact, (3) fuzzy по фамилии. При первом матче по ФИО — обогащение `hr_manager_syncs.hh_manager_id`.
  - Кодировка: UTF-8 BOM с fallback на windows-1251 (`decodeCsv`).
- `lib/google-sheets.ts`: явная сборка credentials с `type:'service_account'`,
  переменная `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (бывшая `_KEY`). `SheetRow.cells: string[]`
  для листов с пустым заголовком колонки.
- `politeness_company` больше не CSV — считается **weighted average по менеджерам** (вес = `responses_received`) в `/api/stats/politeness`.

### UI (Блок 4) — все экраны SPEC Блок 0 готовы
`/cabinet`, `/dashboard` + `/efficiency` + `/divisions` + `/manager`, `/vacancies` (+`/[id]`, `/new`, `/[id]/edit`),
`/bonuses`, `/plan`, `/staffing`, `/sync` + `/sync/logs`, `/ai` + `/ai/report/[week]`, `/admin/{users,integrations,logs}`.

Свежие правки:
- **`/reset-password`** создана (PKCE `?code=` + implicit hash, redirect по роли).
- **`/sync` (`SyncClient.tsx`)** — две карточки: «Аналитика вакансий» / «Статистика менеджеров» (зон `calls` и `company_politeness` больше нет).
- **«Уволен» бейдж** в 4 списках (`/dashboard/efficiency` Select+таблица, `/dashboard/manager` Select, `/bonuses`, `/vacancies`) — `ManagerName`.
- **EfficiencyClient**: убрано поле `avg_response_hours` (в новом отчёте HH этой колонки нет).

### Закрытые блокеры / должно-фиксы

**🔴 Cross-model review 4.5 (все закрыты):**
- RLS-дыры `FOR ALL WITH CHECK(TRUE)`, `handle_new_user` whitelist, hires KPI scaling, politeness `today→week` mapping.

**🟠 5 should-fix перед prod (закрыты, см. соответствующие коммиты до сессии):**
1. CSV size limit 10 MiB → 413 FILE_TOO_LARGE
2. Admin self-deactivate / last active admin guard
3. Audit-триггер маскирует `hh_access_token`/`hh_refresh_token`
4. `ai/client.ts` `JSON.parse` → `AI_PARSE_ERROR` (502)
5. AI rate-limit — per-company (не per-user)

**EC-фиксы:**
- **EC-03** auto-close (HH 404 / `Архивная=Да`) — теперь приходит из CSV `vacancies`, не зависит от OAuth.
- **EC-08** skip inactive manager (раньше в OAuth-кроне).

**Прод-500 на `/dashboard` пофикшен (`d1c3946`):** safe-destructuring `getUser()`, `.maybeSingle()`, `signOut` обёрнут в try/catch, `redirect()` пропускается через `isRedirectError`.

**RSC-граница на layout пофикшена (`36d6858`):** `NavItem.icon` (LucideIcon = function) больше не пересекает Server→Client; `SidebarNav` принимает `role`, считает `items` сам.

---

## 🔄 Текущий статус

### Деплой
- **Vercel** — фронт задеплоен; на main каждый коммит → продакшн.
- **Supabase (PG17)** — `config.toml` указывает `major_version=17`. Миграции **частично** применены — точный список применённых нужно сверить через Supabase Dashboard → SQL → `supabase_migrations.schema_migrations`. Безопасно повторно `supabase db push` — все миграции идемпотентны (`IF NOT EXISTS` / `CREATE OR REPLACE` / partial `DROP`).

### Sync Google Sheets — ⚠️ работает, но возвращает **0 записей**
**Симптом:** `POST /api/sync/sheets` отвечает 200, `vacancies_upserted: 0`, `closed: 0`, в БД ничего не появляется.

**Что точно работает:** аутентификация Google API (иначе вернулось бы 502 `SHEETS_AUTH_ERROR` — обработка есть в [route.ts:233](src/app/api/sync/sheets/route.ts#L233)).

**Подозреваемые причины (по убыванию вероятности):**
1. **Имя листа.** Дефолт сменён на `Data`, но env `GOOGLE_SHEETS_VACANCIES_TAB` на Vercel может ещё указывать на старое имя или быть пустым; либо лист в самой Google-таблице называется иначе (например, кириллица «Data» vs латиница).
2. **Все строки пропущены `skipped_no_manager`** — нормализованное ФИО из колонки O не совпадает ни с одним `user_profiles.full_name`. Проверить через ответ API: смотреть `skipped_no_manager_rows` (массив `{ row, name }`).
3. **Все строки пропущены `skipped_no_title`** — колонка A пуста или короче 2 симв.
4. **Заголовки сместились** — например, колонка статуса теперь не N (index 13); тогда статус читается как пусто, ВСЕ становятся `'active'`, но всё равно должны upsert-иться. Маловероятно как причина именно «0 записей».

**Где смотреть:** `/sync/logs` (UI) → последний запуск `source='sheets'`. `error_message` / `records_total` / `records_updated`. Если `records_total=0` — `readSheetTab` ничего не вернул (имя листа / доступ). Если `records_total>0` а `records_updated=0` — данные читаются, но всё попадает в skipped (см. п.2/3).

**План диагностики — это следующий шаг (см. ниже).**

### Env vars в Vercel — что должно быть установлено

Из [.env.example](.env.example) (актуальный набор после переименований):

| Группа | Переменная | Назначение |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` | ✓ задаёт URL проекта |
| Supabase | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ публичный ключ для браузера |
| Supabase | `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ только сервер, минует RLS |
| Google Sheets | `GOOGLE_SHEETS_SPREADSHEET_ID` | ID таблицы (из URL Sheets) |
| Google Sheets | `GOOGLE_SHEETS_VACANCIES_TAB` | **должно быть `Data`** |
| Google Sheets | `GOOGLE_SHEETS_MANAGERS_TAB` | **должно быть `HR_менеджеры`** |
| Google Sheets | `GOOGLE_SHEETS_BONUSES_TAB` | `Бонусы_HR` |
| Google Sheets | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | service-account email |
| Google Sheets | `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | **переименовано** из `_KEY` (см. `def46d5`). Литералы `\n` в PEM. |
| AI | `ANTHROPIC_API_KEY` | для `/api/ai/*` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID` | алерты (опционально) |

Удалена `HH_CSV_ENCODING` — кодировка теперь автодетект (`decodeCsv`).

⚠️ **Проверить на Vercel:** значение `GOOGLE_SHEETS_VACANCIES_TAB` и наличие `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (если ещё `_KEY` — sync даст `SHEETS_AUTH_ERROR`).

---

## ⬜ Ожидающие задачи

### HH OAuth (#22195) — ждём подтверждения партнёра
Заявка на partner-приложение HH (для legacy-OAuth-флоу через `lib/hh-api.ts`).
В новой архитектуре прод не зависит от OAuth — данные приходят из CSV-выгрузок аналитики.
OAuth понадобится для **near-real-time** обновления воронки (CSV выгружается вручную, max раз в день).
Когда #22195 одобрят:
- Включить cron-скрипт `scripts/sync-hh.ts` (не написан, см. блок «Cron» ниже).
- Менеджерам подключить токены через `/admin/integrations` (`hh/[manager_id]/connect`).

### SMTP — для `/reset-password`
Страница [src/app/(auth)/reset-password/page.tsx](src/app/(auth)/reset-password/page.tsx) готова, но письмо с recovery-ссылкой Supabase сейчас не отправляет (или летит в спам через дефолтный supabase.io SMTP).
Нужно: Supabase Dashboard → Authentication → SMTP → подключить корпоративный SMTP (Yandex 360 / SendGrid / Mailgun).
Шаблон письма «Reset password» — кастомизировать с корректной ссылкой на `https://<host>/reset-password` (без `/auth/` — route group `(auth)` не даёт префикс).

### Татьяна — выдать пароль / доступ
Создать профиль в Supabase Auth (Dashboard → Authentication → Add user) + запись в `user_profiles` с ролью `manager` (или нужной).
После выдачи доступа — менеджер должен войти и при необходимости сменить пароль через `/reset-password`.

### Cron-скрипты (Beget VPS, `scripts/`) — НЕ начато
`sync-hh.ts`, `sync-mango.ts`, `refresh-hh-tokens.ts`, `generate-weekly-report.ts` — отложено до получения HH OAuth. Логика частично переиспользуется из `lib/hh-api.ts`, `lib/mango.ts`, `lib/ai/*`.

### 🟠 Из ревью 4.5 (необязательные, до v2)
- Middleware ролевых редиректов (сейчас защита в page-guard'ах).
- RLS `ai_insights` / `hh_manager_stats`: `manager_id IS NULL` виден любому авторизованному.
- `politeness_company` пишется DELETE+INSERT (теперь unused — индекс компании считается в API, можно почистить таблицу).

---

## ▶️ Следующий шаг: разобраться, почему `/api/sync/sheets` возвращает 0 записей

### Диагностический чек-лист
1. **Открыть `/sync/logs`** → найти последний запуск `source='sheets'`. Зафиксировать `records_total`, `records_updated`, `error_message`.
2. **Запустить sync через UI** (`/sync` → кнопка Google Sheets) — посмотреть ответ в Network-вкладке DevTools. В JSON будет:
   - `vacancies_upserted` — сколько строк прошло до upsert.
   - `skipped_no_title` — пустые названия.
   - `skipped_no_manager` + `skipped_no_manager_rows: [{ row, name }]` — кого не нашли.
   - `bonuses_upserted`, `skipped_managers` — из блока HR-менеджеров.
3. **Проверить Vercel env vars:**
   ```
   GOOGLE_SHEETS_VACANCIES_TAB = Data         # не «Вакансии» и не пусто!
   GOOGLE_SHEETS_MANAGERS_TAB  = HR_менеджеры # с подчёркиванием, не пробелом
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY         # не _KEY!
   ```
4. **Проверить лист в Google-таблице:**
   - Имя вкладки точно `Data` (или то что в env). Регистр и язык важны.
   - Сервис-аккаунт (значение `GOOGLE_SERVICE_ACCOUNT_EMAIL`) расшарен на таблицу с правом Viewer.
   - Строка 1 — заголовки, строка 2+ — данные.
5. **Если `skipped_no_manager` > 0** — открыть [src/app/api/admin/users](src/app/api/admin/users) и сверить `user_profiles.full_name` с тем что в колонке O листа. Расхождение в пробелах / ё/е / инициалах vs полное ФИО. Решения: (a) поправить ФИО в листе под `user_profiles`, (b) сделать `full_name` в листе единым стилем, (c) усложнить `normalizeFullName` (например, поддержать «Иванов И.И.» ↔ «Иванов Иван Иванович»).
6. **Если `records_total=0`** — `readSheetTab` ничего не вернул:
   - сервис-аккаунт не имеет доступа → молчаливый пустой ответ HH/Google
   - имя вкладки неправильное → Google вернёт ошибку (упадёт в SHEETS_SYNC_ERROR)
   - запустить хелс-чек: `POST /api/admin/integrations/sheets/test` (admin-only) — он читает meta `VACANCIES_TAB()` и вернёт headers/totalRows. Это самый быстрый изолированный тест связи + имени вкладки.

### Что я бы добавил в код для лучшей диагностики (пока не делал)
- В ответе sync добавить `headers_found: string[]` (фактические заголовки строки 1) — сразу видно, считалось ли вообще что-то.
- В `sync_logs.error_message` записывать первые 3 имени из `skipped_no_manager_rows` при `records_updated=0` — чтобы можно было дебажить без вызова UI.

---

## 📝 Последние коммиты

```
2826568 fix: vacancy snapshots dedup migration
def46d5 chore: rename Google Sheets env vars and HR menedzhery tab to underscore form
89e1d51 fix: google sheets auth credentials
c5f004e feat: CSV sync for HH vacancies and managers
36d6858 fix: pass role not icon functions across RSC boundary
d1c3946 fix: dashboard 500 - safe destructuring, maybeSingle, redirect handling
d56300d initial commit
```

Незакоммичено сейчас (working tree):
- `supabase/migrations/20260523150000_vacancies_sheets_fields.sql`
- `src/types/database.ts` (+location/positions_count/customer_name)
- `src/lib/google-sheets.ts` (VACANCIES_TAB='Data', SheetRow.cells)
- `.env.example` (VACANCIES_TAB=Data)
- `src/app/api/sync/sheets/route.ts` (Data → vacancies + hired_employees dual write)
- `HANDOFF.md` (этот файл)

Готово к одному коммиту: `feat: sheets sync via Data tab (vacancies upsert + dual write to hired_employees)`.

---

## ⚠️ Ключевые решения, отклоняющиеся от SPEC (актуальные)

1. **Окно редактирования активностей — 30 дней** (а не 7 из SPEC §5.2). **Не откатывать.**
2. **Статус KPI: `'lagging'`** (не SPEC `'behind'`) для 70–89%.
3. **service-role в `/api/dashboard/team` и `/divisions`** — RLS не пускает executive.
4. **`hires_per_month` масштабируется** по workdays периода (`scaledHiresPlan`).
5. **HH CSV вместо OAuth API** — основная архитектура синхронизации с HH. OAuth остаётся в `lib/hh-api.ts` для будущего near-real-time.
6. **Google Sheets лист «Data»** (не «Вакансии») — источник истины по вакансиям. Колонка статуса — N без заголовка.
7. **`avg_response_hours`** убран из UI (поле БД остаётся nullable). Новый отчёт HH этой колонки не отдаёт.
8. **`politeness_company`** считается на лету как weighted average по менеджерам, не из отдельного CSV.
9. **`/reset-password`** живёт на `/reset-password` (не `/auth/reset-password` как в SPEC) — route group `(auth)` без префикса.
10. **`PostgreSQL 17`** (не 15 как было в SPEC). Sync'нуто во всех источниках: `config.toml`, SPEC, CLAUDE, supabase/README.
