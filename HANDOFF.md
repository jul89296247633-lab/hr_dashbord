# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-24 (вечер)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🔥 Что делать первым в следующей сессии

**Проблема:** `vacancy_snapshots` остаётся пустым после успешной загрузки CSV
`recruitment_analytics_vacancies_*.csv` через `/sync`. Воронка отдела (Отклики /
Контакты / Приглашения / Звонки) показывает нули.

**В коммите `8efbbbf` добавлены диагностические логи** в hh-csv
`?type=vacancies`:
- `console.log('SNAPSHOT INSERT:', { vacancy_id, snapshot_at, responses_count })`
- `console.error('SNAPSHOT ERROR:', message, details, hint, code)` при ошибке insert.
- Ошибка теперь не теряется в `await db.from(...).insert(...)` без проверки.

**План:** дождаться следующего CSV upload, посмотреть Vercel-логи функции
`/api/sync/hh-csv`, найти причину тишины:
- `SNAPSHOT INSERT` логи не появляются → все строки попали в один из skip-блоков
  (`matchedNoVacancy`, `rows_skipped_locked`, или пустой `hhId`).
- `SNAPSHOT ERROR` логи появились → RLS-deny / column-mismatch / FK-нарушение.
- Логи есть, но `vacancy_snapshots = 0` → транзакционный rollback в админ-клиенте,
  пермиссии service_role.

После диагностики — удалить временные логи и commit.

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

Типы `src/types/database.ts` синхронизированы.

### API
- `dashboard/team`, `dashboard/manager`, `dashboard/me`, `dashboard/divisions`,
  `stats/politeness` — все принимают `?month=YYYY-MM` (MonthPicker).
  `team`/`manager`/`me` считают «Закрыто вакансий» через
  `vacancies WHERE status='closed' AND closed_at ∈ month`. План «Закрыто
  вакансий» на /dashboard скрыт (sum-of-defaults давал 300).
- `divisions` `hired_in_period` + `funnel.hired` — также через `vacancies.closed_at`
  (EC-03 auto-close из hh-csv не пишет в `hired_employees`, поэтому нельзя оттуда
  читать — было расхождение 22 vs 56).
- `bonuses/` — RPC `compute_manager_bonuses` за текущий месяц.
  **NB:** RPC по-прежнему читает `hired_employees` — поэтому бонусы посчитаны только
  для тех 22 закрытий, что прошли через sheets sync. EC-03 закрытия (~34) бонусом
  не покрыты. Если нужно — переключить RPC на vacancies.
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
- `/vacancies` — колонка «Город» между «Подразделение» и «Менеджер».
- `/bonuses` — таблица «Менеджер | Вакансия | Тариф | Сумма»; «Тариф не задан»
  курсивом если fuzzy < 0.6.
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
2. **CSV vacancies upload + посмотреть Vercel-логи** (см. блок «Что делать первым»).
3. **HH OAuth #22195** — ждём подтверждения партнёра. Cron-скрипты ждут.
4. **SMTP для `/reset-password`** — Supabase Dashboard → Auth → SMTP.
5. **Татьяна** — выдать пароль/доступ.

### Код — не начато
- **Cron-скрипты** (`scripts/sync-hh.ts` и т.п.) — отложено до HH OAuth.
- **Бонусы через vacancies** — `compute_manager_bonuses` сейчас читает
  `hired_employees`. Не учитывает ~34 EC-03 закрытия. Можно расширить RPC.
- **Дроп `hr_bonuses`** — не используется, но не дропнута.
- **Удалить временные DEBUG-логи** в `sheets/route.ts` и `hh-csv/route.ts`
  после завершения диагностики.

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
19. **«Активные вакансии»** на дашборде = `WHERE status='active' AND
    hh_vacancy_id IS NOT NULL` (исключает CSV-фантомы, но их больше и не создаём).
20. **Воронка дашборда** полностью из `vacancy_snapshots`:
    Отклики / **Контакты** = invitations_from_responses (бесплатно) /
    **Приглашения** = invitations_from_db (платно ⓟ) / Звонки = calls_count.
21. **MonthPicker** на `/dashboard`: Tabs «Сегодня/Неделя» + Select последних
    12 месяцев. API получают `?period=month&month=YYYY-MM`.
22. **Lock-period:** `vacancy_snapshots.is_locked`. POST `/api/sync/lock-period`
    фиксирует месяц; hh-csv с историческим `stat_date` пропускает locked.

---

## 📝 Последние коммиты этой сессии

```
8efbbbf chore: hh-csv — log SNAPSHOT INSERT + capture insert error
322c26a feat: sheets sync — paused statuses (приостановлена/предзакрыта)
88c0318 feat: month picker on /dashboard + lock-period for historical data
b950a76 fix(divisions): «Закрыто за период» source = vacancies.closed_at
0e87b3d fix(politeness,sync): exclude zero ИВ from avg; log snapshot counts
06fdb36 fix: /dashboard «Закрыто вакансий» — hide misleading 300 plan
2243fbe fix(dashboard,sync): rework funnel sources, active filter, rename Выведено
4c64f1c feat: hh-csv auto-create vacancies + users (вакансии-часть откатана 2243fbe)
d1b9d6b chore+fix+feat: cleanup debug, hh-csv column aliases, /admin/* role gate
ea78933 docs: HANDOFF / PROJECT_IDEA / SPEC
7f37df2 fix: «Выведено» counter — current month
8cc1e74 fix: sheets sync — dedupe by (title, manager_id, opened_at)
4600be3 feat: per-manager «Бонус за месяц»
e2c5441 feat: sheets sync — auto-create users from Data rows
11baafa feat: /bonuses — month header + Tariff column + seed
cb89e0a feat: /dashboard — «Активных вакансий» KPI card
6d2313c fix: sheets sync — multiple header aliases for location
89cf9d3 docs: refresh HANDOFF (предыдущая итерация)
```

В working tree (некоммитнуто):
- `.gitignore` — старая правка пользователя (`+.vercel`, `+.env*`).
- `HANDOFF.md` — этот файл (коммитится отдельно).
