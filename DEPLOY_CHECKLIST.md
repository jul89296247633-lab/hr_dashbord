# Deploy Checklist — HR Control Tower

> Перед каждым деплоем в прод пройти все пункты. Помечены: 🔴 блокер релиза | 🟡 желательно | 🟢 информационно.

---

## 🔴 БЛОКЕРЫ РЕЛИЗА

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

### 5. Применены все миграции FS-2

В Supabase Dashboard → Database → Migrations убедиться, что применены:
- `20260530000000_recreate_hr_bonuses`
- `20260530010000_auto_bonus_trigger`
- `20260530020000_bonus_rates_admin_only`

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
