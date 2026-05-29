# HANDOFF — HR Control Tower

> Сводка состояния проекта. Обновлено: **2026-05-29 (ночь)**.
> Источник истины — `SPEC.md`. Правила команды — `CLAUDE.md`.
> Стек: Next.js 15 (App Router, `src/`), TypeScript, Tailwind v4, shadcn/ui, Supabase PG17, Zod.

Проверка после изменений: `npx tsc --noEmit`, `npm run lint`, `next build` — все три зелёные.

---

## 🔥 Что делать первым в следующей сессии

**HH OAuth #22195 подтверждён партнёром — главный блокер снят.** Cron-скрипты можно реализовывать прямо сейчас.

### Ожидает внешних действий (не код)
1. **Добавить 43 фантомные «закрытые» вакансии за май в лист «Data»** — без этого май = 0 закрытых в KPI.
2. **SMTP для `/reset-password`** — Supabase Dashboard → Auth → SMTP.
3. **Татьяна** — выдать пароль/доступ.

### Ближайшие код-задачи (по приоритету)
1. **Cron-скрипты** — блокер снят, делать сейчас:
   - `scripts/refresh-hh-tokens.ts` — первым (разблокирует sync-hh)
   - `scripts/sync-hh.ts` — основной cron каждые 2ч
   - `scripts/sync-mango.ts` — ежедневно 20:00
   - `scripts/generate-weekly-report.ts` — пятница 20:30
2. **`lib/telegram.ts`** + алерты в cron (TELEGRAM_BOT_TOKEN уже в .env)
3. **Удалить console.log** в `hh-csv/route.ts` — lint `no-console` горит
4. **`/api/ai/report/[week]` + `/ai/report/[week]` page** — страница детального weekly_report
5. **trend_14d sparklines** в `/vacancies/[id]` (recharts, 14 точек)
6. **Dashboard: Sheet-панель** при клике на менеджера + CSV export

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
| `20260529000000_vacancy_request` | `vacancies`: +request_* поля, +confidentiality, +internal_ref. RPC `gen_internal_ref()`. Триггер `enforce_request_approval`. RLS `vacancies_request_approve` (guard: не своя заявка). |
| `20260529010000_vacancy_request_fixes` | Триггер: guard только при `requested_by IS NOT NULL`. RLS: `auth.uid() IS DISTINCT FROM requested_by`. |
| `20260529020000_hr_manager_syncs_hh_id_full_index` | Полный индекс на `hh_manager_id` для diff-builder lookup. |
| `20260529030000_staffing_plan_occupied_units` | `staffing_plan.occupied_units INTEGER NOT NULL DEFAULT 0`. Обновлён RPC: `occupied = occupied_units` (убран LATERAL JOIN по `hired_employees`), `vacant = planned - occupied_units - in_progress`. |
| `20260529040000_drop_hr_bonuses_table` | **DROP TABLE hr_bonuses CASCADE** — таблица пустая с создания, нигде не использовалась. |

Типы `src/types/database.ts` синхронизированы. Блок `hr_bonuses` удалён.

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

### UI
- `/dashboard` — Tabs «Сегодня/Неделя» + MonthPicker. KPI-ряд 5 карточек. Воронка.
- `/dashboard/efficiency` — «Бонус за месяц», ИВ с платными метриками.
- `/dashboard/divisions` — карточка городов + «Закрыто за период».
- `/vacancies` — «Город», «Дней в работе» (цвет + ⚠️), сортировка, truncate.
- `/bonuses` — группировка по менеджеру, sub-total, grand-total.
- `/cabinet` — «Мой бонус за месяц».
- `/sync` — «Зафиксировать месяц».
- `/requests` — табы pending/approved/rejected, модалка создания, ApprovalActions, ActivateModal.
- `/onboarding` — 3-шаговый мастер (только admin): скачать шаблон → загрузить → применить.
- `/staffing/plan` — **StaffingPlanTable**: плоская таблица, фильтр по городу, подытоги по городу, tfoot ИТОГО (пересчитывается по видимым строкам). Форма add/edit: поля «Кол-во единиц (план)» + «Занято (факт)» рядом.
- `/admin/integrations` — HH OAuth кнопка `ExternalLink` + ручной fallback + toast после callback.

### Sync — особенности
- Sheets дедуп вакансий = `google_sheet_row` (singular key).
- `hr_manager_syncs` дедупируется по `sheet_full_name` ИЛИ `hh_manager_id` (фикс `41d56f2`).
- `rublesToKopecks` перенесена в `lib/utils.ts` (используется и в sheets-sync, и в XLSX-онбординге).
- HH OAuth callback **не проверяет сессию** (cross-domain redirect теряет SSR-cookies); безопасность через одноразовый code + зарегистрированный redirect_uri.
- XLSX upload: лимит 10 МБ, проверка владельца перед apply (admin может любой, head — только свой).

---

## ⬜ Ожидающие задачи

### По SPEC — не реализовано

| Приоритет | Задача | Зависит от |
|---|---|---|
| 🔴 | `scripts/refresh-hh-tokens.ts` | — (делать сейчас) |
| 🔴 | `scripts/sync-hh.ts` | ~~HH OAuth партнёр~~ **подтверждён** |
| 🔴 | `scripts/sync-mango.ts` | Mango .env |
| 🔴 | `scripts/generate-weekly-report.ts` | Anthropic API |
| 🔴 | `lib/telegram.ts` + алерты в cron | — |
| 🟡 | `GET /api/ai/report/[week]` + `/ai/report/[week]` page | — |
| 🟡 | trend_14d sparklines в `/vacancies/[id]` (recharts) | — |
| 🟡 | Dashboard: Sheet-панель при клике на менеджера | — |
| 🟡 | Dashboard: CSV export | — |
| 🟡 | Executive: графики «Выведено по месяцам» + «Открытые вакансии» | — |
| 🟢 | Cabinet: PencilLine индикатор при `calls_source='manual'` | — |
| 🟢 | Timestamp «Данные актуальны на HH:MM» в воронке вакансии | — |

### Прод-операции
1. ~~**HH OAuth #22195**~~ — **подтверждён**, блокер снят.
2. **43 фантомные закрытые вакансии** — добавить в лист «Data» → sheets-sync.
3. **SMTP** — Supabase Dashboard → Auth → SMTP.
4. **Татьяна** — выдать пароль/доступ.

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
12. «Бонусы_HR» — справочник тарифов (bonus_rates), не журнал. **hr_bonuses УДАЛЕНА** (была пустой).
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

---

## 📝 Последние коммиты (2026-05-29, эта сессия)

```
e14a9cd chore: drop пустую hr_bonuses + вынести rublesToKopecks в utils
10d66fa feat(staffing): StaffingPlanTable — итого, подытоги по городу, фильтр
851a001 fix(security): убрать debug-логи OAuth, проверка владельца upload, лимит 10МБ
4d42abe debug(auth): маскированный лог credentials перед token exchange
248c9f4 debug(auth): console.log на каждом шаге HH OAuth callback для Vercel Logs
f12697a fix(auth): .trim() для HH_CLIENT_ID, HH_CLIENT_SECRET, HH_REDIRECT_URI
61c2742 fix(auth): исправить HH OAuth callback — потеря сессии и нет обновления UI
970bb72 feat(auth): HH OAuth authorization_code flow
c6008e2 feat(staffing): occupied_units — ручной ввод факта занятых единиц
1b22195 docs: обновить HANDOFF — сессия 2026-05-29 (онбординг, заявки, фикс hh_manager_id)
```

### Предыдущая сессия (2026-05-28/29 утро)
```
41d56f2 fix(onboarding): hr_manager_syncs duplicate hh_manager_id on XLSX upload
b3897de feat(ui): /requests + API заявок на вакансию
4f10ffa feat(db): vacancy_request migration + gen_internal_ref RPC
5a2016f fix(templates): must-fix/should-fix из code review
c13b7df feat(ui): /onboarding — 3-шаговый мастер
f6feda5 feat(templates): Блок 2 API — lib/templates/*
```

Working tree чистый.
