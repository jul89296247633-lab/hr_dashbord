# Deploy Checklist — HR Control Tower

> Перед каждым деплоем в прод пройти все пункты. Помечены: 🔴 блокер релиза | 🟡 желательно | 🟢 информационно.

---

## 🔴 БЛОКЕРЫ РЕЛИЗА

### 0. КРИТИЧЕСКИ ВАЖНО: Workflow миграций — НЕ ИСПОЛЬЗОВАТЬ db push / db pull

> **Это правило нельзя обойти. Нарушение ломает историю миграций необратимо.**

**Причина:** Часть миграций была применена через Supabase MCP / SQL Editor — они записались в `supabase_migrations.schema_migrations` с timestamp исполнения (`20260529152038`…), а не с version-prefix из имени файла (`20260529030000`…). Расхождение версий постоянное.

**Следствие:**
- `supabase db push` не найдёт эти версии в remote, решит что они не применены, попытается накатить повторно → ошибки `already exists`, дубли объектов
- `supabase db pull` создаст локальные файлы с чужими timestamp-именами — дубли существующих локальных файлов

**Единственный допустимый workflow для всех миграций:**

```
1. Написать SQL → сохранить в supabase/migrations/YYYYMMDDHHMMSS_name.sql
2. Применить SQL напрямую:
   - Supabase Dashboard → SQL Editor  ← предпочтительно
   - ИЛИ MCP tool: apply_migration
3. Зарегистрировать в таблице миграций:

   INSERT INTO supabase_migrations.schema_migrations (version, name)
   VALUES ('<version из имени файла>', '<name без .sql>')
   ON CONFLICT (version) DO NOTHING;

4. Проверить: supabase migration list (CLI) или
   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
```

**Перед ЛЮБОЙ новой миграцией** — убедиться в текущем состоянии:
```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;
```

**Известное расхождение (зафиксировано 2026-05-30):**

| Локальный файл | Version в remote | Статус |
|---|---|---|
| `20260529030000_staffing_plan_occupied_units` | `20260529152038` | ✅ применена, версия расходится |
| `20260529040000_drop_hr_bonuses_table` | `20260529192420` | ✅ применена, версия расходится |
| `20260530000000_recreate_hr_bonuses` | `20260529194910` | ✅ применена, версия расходится |
| `20260530010000_auto_bonus_trigger` | `20260529194951` | ✅ применена, версия расходится |
| `20260530020000_bonus_rates_admin_only` | `20260529195004` | ✅ применена, версия расходится |
| `20260530030000_bonus_rates_audit_trigger` | `20260529195941` | ✅ применена, версия расходится |

Эти расхождения уже зафиксированы и не мешают работе — важно не усугублять новыми.

---

### 1. Интеграционные тесты RLS + триггер

**Статус: НЕ ПРОГНАНЫ АВТОМАТИЧЕСКИ** (Docker не доступен в CI по умолчанию)

RLS-политики `hr_bonuses` и триггер `auto_create_bonus_on_close` **не подтверждены прогоном тестов** — только анализом кода и миграций. Без прогона RLS считается непроверенной.

**Обязательный шаг перед деплоем:**

```bash
# 1. Запустить Supabase локально (требует Docker)
supabase start

# 2. Убедиться, что переменные окружения установлены:
#    SUPABASE_LOCAL_URL=http://127.0.0.1:54321
#    SUPABASE_SERVICE_KEY=<service_role key из `supabase status`>
#    SUPABASE_ANON_KEY=<anon key из `supabase status`>

# 3. Прогнать интеграционные тесты
npm run test:integration

# 4. Ожидаемый результат: Tests 6 passed (6)
```

Файл тестов: [src/tests/integration/rls-trigger.test.ts](src/tests/integration/rls-trigger.test.ts)

Что проверяется:
- `manager` видит только свои `hr_bonuses` (RLS SELECT)
- `manager` не может делать INSERT в `hr_bonuses` (RLS INSERT заблокирован)
- `head` видит все `hr_bonuses` (RLS SELECT)
- UPDATE `vacancies.status → 'closed'` создаёт `hr_bonuses` (триггер)
- Повторное закрытие не создаёт дубль (UNIQUE vacancy_id)
- PATCH `bonus_rates` пишет запись в `audit_logs` с `old_values`/`new_values`

**Без зелёных тестов — деплой запрещён.**

---

### 2. TypeScript

```bash
npx tsc --noEmit
# Ожидаемый результат: 0 ошибок
```

### 3. Lint

```bash
npm run lint
# Ожидаемый результат: 0 errors
```

### 4. Unit + Component тесты

```bash
npm run test
# Ожидаемый результат: Tests 113 passed (113)
```

### 5. Миграции применены и зарегистрированы

Проверить через SQL Editor:
```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 15;
```

Убедиться, что присутствуют (в любом виде version):
- `mango_extension_unique` — `20260530040000` или timestamp от SQL Editor
- `hr_manager_syncs_hh_id_full_index` — `20260529020000` или timestamp от SQL Editor
- `bonus_rates_audit_trigger`
- `bonus_rates_admin_only`
- `auto_bonus_trigger`
- `recreate_hr_bonuses`

---

## 🟡 ЖЕЛАТЕЛЬНО

- [ ] `next build` проходит без ошибок
- [ ] Smoke test `/admin/bonuses` — загружается список тарифов
- [ ] Smoke test `/vacancies/admin` — загружается таблица вакансий
- [ ] Smoke test `/bonuses` — все три таба работают

---

## 🟢 ИНФОРМАЦИОННО

- Триггер `trg_auto_create_bonus_on_close` — BEFORE UPDATE на `vacancies`. Работает для всех путей: ручное закрытие, API, sheets-sync.
- `bonus_rates` INSERT/UPDATE/DELETE — только `role='admin'` (ужесточено с head/admin в миграции `20260530020000`).
- `hr_bonuses` UNIQUE(vacancy_id) — один бонус на закрытие. Повторное закрытие (closed→active→closed) дублей не создаёт.
- `mango_extension` UNIQUE partial index — NULL не конфликтуют. Один добавочный Mango на менеджера.
