# План RLS-интеграционных тестов — HR Control Tower

> **Проект:** Yamaguchi HR Control Tower
> **Supabase project_id:** `twfmfmkqfhclzvdogvix` (НЕ posting/Четвёртый Форс)
> **Дата:** 2026-06-02
> **Статус:** последний prod-блокер до PR feature → main
> **Предусловие:** Docker Desktop установлен, `supabase start` поднимает локальный стек

---

## Принцип

Advisors показывают что политика существует. Тесты должны доказать, что политика
**реально изолирует** — не пускает туда, куда нельзя. Для каждой таблицы:
позитивный кейс (своё видно) + негативный (чужое НЕ видно).

Каркас каждого теста:
1. `BEGIN` транзакция
2. Создать/взять тестовых: 2 manager + 1 head + 1 admin + 1 executive
3. `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"<id>","role":"manager"}'`
4. SELECT/INSERT/UPDATE → assert (видно/не видно, разрешено/запрещено)
5. `ROLLBACK` — ничего не оседает

---

## Реальная структура RLS прода (18 таблиц, на 2026-06-02)

| Таблица | SELECT | INSERT | UPDATE | DELETE | ALL | Всего |
|---|---|---|---|---|---|---|
| ai_insights | 1 | 1 | 1 | — | — | 3 |
| audit_logs | 1 | — | — | — | — | 1 |
| bonus_rates | 1 | — | — | — | 1 | 2 |
| daily_activities | 1 | 1 | 1 | — | 1 | 4 |
| error_logs | — | — | — | — | 1 | 1 |
| hh_manager_stats | 1 | — | — | — | — | 1 |
| hired_employees | 1 | — | — | — | — | 1 |
| hr_bonuses | 1 | 1 | 1 | 1 | — | 4 |
| hr_manager_syncs | 1 | — | — | — | — | 1 |
| impersonation_logs | 1 | — | — | — | — | 1 |
| manager_plans | 1 | 1 | — | — | — | 2 |
| staffing_plan | 1 | 1 | 1 | 1 | — | 4 |
| staffing_records | 1 | 1 | — | — | — | 2 |
| sync_logs | 1 | — | — | — | — | 1 |
| template_uploads | 1 | 1 | 1 | — | — | 3 |
| user_profiles | 1 | — | 1 | — | 1 | 3 |
| vacancies | 1 | 1 | 2 | — | 1 | 5 |
| vacancy_snapshots | 1 | — | — | — | — | 1 |

---

## Группа 1 — Изоляция по менеджеру (КРИТИЧНО: деньги + PII)

| Таблица | Позитивный | Негативный |
|---|---|---|
| hr_bonuses | manager видит свои бонусы | manager НЕ видит бонусы др. менеджера |
| vacancies | manager видит свои вакансии | manager НЕ видит чужие |
| daily_activities | manager видит свои активности | manager НЕ видит чужие |
| manager_plans | manager видит свой план | manager НЕ видит чужой |
| hh_manager_stats | manager видит свою статистику | manager НЕ видит чужую |

## Группа 2 — Запись только своих ролей

| Таблица | Кейс |
|---|---|
| bonus_rates | manager НЕ может INSERT/UPDATE (только admin); head НЕ пишет (только читает для match-модала) |
| hr_bonuses | manager НЕ может INSERT/UPDATE/DELETE (только head/admin) |
| staffing_plan | manager НЕ пишет; executive read-only; head/admin CRUD |
| vacancies | manager НЕ меняет чужие; защита self-approve заявок (auth.uid() IS DISTINCT FROM requested_by) |
| manager_plans | manager НЕ создаёт план (только head/admin) |

## Группа 3 — Executive не видит PII (EC-09)

**ВАЖНО:** скрытие имён для executive — это API-слой, НЕ RLS. RLS пускает executive
к строкам, имена убирает код роута. Поэтому:
- Docker RLS-тесты: проверяют что RLS executive ПУСКАЕТ к таблицам
- Скрытие имён: остаётся на API-тестах (executive-pii.test.ts — УЖЕ ЕСТЬ, не трогать)

| Проверка | Слой | Ожидание |
|---|---|---|
| executive читает vacancies | RLS | строки доступны |
| executive читает hr_bonuses | RLS | строки доступны |
| /api/bonuses/summary под executive | API (есть тест) | full_name не в ответе |
| /api/vacancies/requests под executive | API (есть тест) | manager не в ответе |

## Группа 4 — Admin-only таблицы

| Таблица | Кейс |
|---|---|
| audit_logs | только admin читает; manager/head НЕ видят |
| error_logs | только admin (ALL policy) |
| impersonation_logs | только admin читает |
| template_uploads | uploaded_by isolation + admin |

## Группа 5 — Snapshot + триггеры (бизнес-логика, частично есть в rls-trigger.test.ts)

| Проверка | Ожидание |
|---|---|
| изменить bonus_rates после начисления | старые hr_bonuses.bonus_amount_kopecks НЕ меняются |
| закрыть вакансию дважды | один бонус (UNIQUE vacancy_id) |
| draft→closed | бонус НЕ создаётся (guard OLD.status='draft') |
| active→closed | бонус создаётся (регресс-контроль) |
| NULL manager_id | бонус НЕ создаётся (намеренный guard, 0/200 безменеджерных) |

---

## Структура файлов

```
src/tests/integration/
  rls-isolation.test.ts     ← Группы 1, 2, 4
  rls-snapshot.test.ts      ← Группа 5 (расширение rls-trigger.test.ts)
  (executive-pii.test.ts)   ← УЖЕ ЕСТЬ, API-слой, НЕ трогать
```

---

## Порядок реализации (НЕ писать всё сразу)

1. **Один тест первым** — manager1 видит свои hr_bonuses, НЕ видит manager2.
   Прогнать `npm run test:integration`. Цель — проверить что каркас рабочий
   (claims выставляются, auth.uid() работает, изоляция ловится, ROLLBACK чистит).
2. Если зелёный → масштабировать на Группы 1, 2, 4.
3. Группа 5 — расширить существующий rls-trigger.test.ts, не дублировать.
4. Группа 3 — НЕ писать заново, executive-pii.test.ts уже покрывает API-слой.

## Почему с одного теста

Каркас RLS-тестов хрупкий: точный формат request.jwt.claims, как Supabase local
выставляет auth.uid(), изоляция транзакций. Один прогнанный тест докажет каркас.
Потом 18 таблиц — механика. Если написать сразу всё и каркас неверный — переписывать 40 тестов.

---

## После зелёного RLS

1. CSP-проверка на production (после merge, не на preview — preview не нашёлся)
2. PR feature/bonuses-admin-vacancies → main
3. После merge → D-1b (отключить блок тарифов в /api/sync/sheets)

---

## Контекст на старте следующей сессии

Первым делом подтвердить:
- работаем по HR-дашборду, project_id = twfmfmkqfhclzvdogvix
- НЕ posting/Четвёртый Форс (к нему привязана рабочая папка и память)
- ветка feature/bonuses-admin-vacancies, последний коммит eafed9d
- FS-2 в проде по БД (миграции применены), 2 блокера сняты (xlsx, CSP), остался RLS
