# Supabase — слой данных HR Control Tower

Схема БД для HR Control Tower (PostgreSQL 17 через Supabase). Единственный источник
истины по структуре — [`SPEC.md`](../SPEC.md) Блок 2. Правила — [`CLAUDE.md`](../CLAUDE.md).

## Структура

```
supabase/
├── config.toml                              # конфиг Supabase CLI (порты, auth)
└── migrations/
    └── 20260522120000_initial_schema.sql    # вся начальная схема (13 таблиц)
```

## Применение

```bash
# Линковка с удалённым проектом (один раз)
supabase link --project-ref <PROJECT_REF>

# Применить миграции к удалённой БД
supabase db push

# Локальная разработка: поднять стек и применить миграции с нуля
supabase start
supabase db reset      # пересоздаёт локальную БД и прогоняет все миграции
```

Миграция **идемпотентна** (`CREATE ... IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`,
`CREATE OR REPLACE FUNCTION`) — повторный `db push` безопасен.

## Порядок секций внутри миграции

1. **EXTENSIONS** — `pgcrypto`, `moddatetime`, `pg_trgm`.
2. **TABLES** — 13 таблиц в порядке зависимостей FK (+ индексы рядом).
3. **RLS** — `ENABLE ROW LEVEL SECURITY` + политики на каждой таблице.
4. **TRIGGERS / FUNCTIONS** — `moddatetime`, `handle_new_user`, `audit_trigger_fn`,
   RPC `fuzzy_match_vacancy` / `find_vacancy_by_title`.

## Таблицы (13)

| Таблица | Назначение | Audit |
|---------|-----------|:-----:|
| `user_profiles` | Профили (id = auth.users.id) | ✅ |
| `vacancies` | Вакансии (`days_to_close` GENERATED) | ✅ |
| `vacancy_snapshots` | Снимки HH-воронки (immutable) | — |
| `daily_activities` | Активности менеджера (UNIQUE manager+date) | — |
| `hired_employees` | Трудоустроенные из Sheets | ✅ |
| `ai_insights` | AI-инсайты | — |
| `hr_manager_syncs` | «Наши» менеджеры из Sheets | — |
| `hr_bonuses` | Бонусы (копейки, INTEGER) | ✅ |
| `hh_manager_stats` | Статистика из HH CSV | — |
| `manager_plans` | Планы KPI (INSERT-only история) | ✅ |
| `staffing_records` | % укомплектованности (INSERT-only) | ✅ |
| `sync_logs` | Журнал синхронизаций | — |
| `audit_logs` | Audit trail (пишется триггером) | — |
| `error_logs` | Ошибки приложения (TTL 90 дней) | — |

## Принципы (см. CLAUDE.md / database.md)

- **RLS включён на ВСЕХ таблицах.** `service_role` (cron/sync) обходит RLS — для записи
  используются политики `FOR ... WITH CHECK (TRUE)`. `SUPABASE_SERVICE_ROLE_KEY` — только на сервере.
- **Деньги** хранятся в копейках (INTEGER): 50 000 ₽ → `5000000`.
- **Audit log** заполняется автоматически триггером `audit_trigger_fn`. НЕ логируются
  `daily_activities`, `vacancy_snapshots`, `hh_manager_stats` (частые/иммутабельные записи).
- **`handle_new_user`** создаёт `user_profiles` при регистрации в `auth.users`
  (роль и `full_name` берутся из `raw_user_meta_data`).

## Проверка после применения

```sql
-- RLS включён у всех таблиц public
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Количество политик по таблицам
SELECT tablename, count(*) FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename;

-- RPC fuzzy-match
SELECT * FROM public.fuzzy_match_vacancy('Менеджер по продажам', 0.3);
```
