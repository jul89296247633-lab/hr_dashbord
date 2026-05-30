# Deploy Checklist — HR Control Tower

> Перед каждым деплоем в прод пройти все пункты. Помечены: 🔴 блокер релиза | 🟡 желательно | 🟢 информационно.

---

## 🔴 БЛОКЕРЫ РЕЛИЗА

### 0. Workflow миграций — ТОЛЬКО supabase db push. apply_migration и SQL Editor ЗАПРЕЩЕНЫ.

> **Это правило не обсуждается. Нарушение ломает историю и требует ручного выравнивания.**

**Единственный допустимый способ применять миграции:**

```bash
# 1. Создать файл миграции (version берётся из timestamp имени файла)
supabase migration new <name>

# 2. Написать SQL в созданный файл

# 3. Применить — ТОЛЬКО так:
supabase db push
```

**ЗАПРЕЩЕНО для миграций:**
- ❌ `supabase_migrations` MCP tool `apply_migration` — пишет `version = execution timestamp`, не из имени файла
- ❌ Supabase Dashboard SQL Editor для DDL — то же самое
- ❌ `execute_sql` с CREATE/ALTER/DROP — то же самое

**Почему это критично:** `apply_migration` и SQL Editor записывают в `schema_migrations.version` реальный timestamp выполнения (например `20260529152038`), тогда как `db push` ожидает там version-prefix из имени файла (`20260529030000`). Расхождение → `db push` не видит уже применённые миграции → пытается применить повторно → `ERROR: already exists`. Выравнивание требует ручных UPDATE с транзакцией и бэкапом — трудоёмко и рискованно.

**История уже была сломана и выровнена 2026-05-30:**
7 записей исправлены через UPDATE (бэкап: `schema_migrations_backup_20260530`). Не повторять.

**Текущее состояние:** 40 applied, 0 pending. Проверить:
```bash
supabase migration list
```

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
