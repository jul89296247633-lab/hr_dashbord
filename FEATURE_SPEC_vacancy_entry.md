# Feature: Ввод вакансий в платформе (закрытие Google Sheets «Data»)

> **Проект:** HR Control Tower
> **Дата:** 2026-05-30
> **Приоритет:** High
> **Оценка:** 1.5–2 дня
> **Зависимости:** vacancy_request workflow (готов). Мульти-HH и авто-штатка (розница/компания) — вне scope, отдельные спеки.

---

## 1. User Story

**Как** руководитель HR (head/admin) / автор заявки (executive, manager),
**я хочу** заводить вакансии прямо в платформе — включая мульти-позиционные заявки и стажировки,
**чтобы** не вести вкладку «Data» в Google Sheets вручную.

### Сценарий
1. Пользователь создаёт заявку: название/город/подразделение (с автодополнением из существующих значений), ФИО заказчика, кол-во ставок, приоритет, менеджер, конфиденциальность.
2. Руководитель согласует (не свою; executive — отдельным шагом даже свою).
3. При активации `opened_at` = дата активации (если не задана вручную head/executive).
4. Если `positions_count = N > 1` → создаётся **N строк-вакансий** одной группы, все `active`, одной датой.
5. По мере закрытия позиций срабатывает **эстафета**: дата открытия следующей в очереди = дата закрытия предыдущей.
6. Стажировка: вакансия переводится в статус «Стажировка» (позиция ещё НЕ укомплектована); при трудоустройстве → «Закрыта», при срыве → обратно «Открыта».
7. Закрытие/стажировка автоматически создаёт запись в `hired_employees` (для дашборда/воронки/AI) — без Sheets.

### Критерии приёмки
- [ ] Форма заявки принимает `customer_name`, `positions_count` (1–100), `priority` (высокий/средний/низкий).
- [ ] Автодополнение для «Название», «Населённый пункт», «Подразделение» из существующих значений (datalist).
- [ ] При активации без явной даты `opened_at` = дата активации.
- [ ] `positions_count=N` создаёт N связанных строк (`position_group_id`), `queue_index` 1..N, все `active`, `opened_at` = дата активации.
- [ ] Закрытие позиции из группы переносит `opened_at` следующей активной позиции на `closed_at` закрытой.
- [ ] Статус «Стажировка» доступен; переходы Открыта↔Стажировка→Закрыта работают; стажировка = НЕ укомплектована.
- [ ] Закрытие вакансии (employee) и перевод в стажировку (intern) создают `hired_employees` автоматически; повторное закрытие дублей не плодит.
- [ ] Отмена (`cancelled`) НЕ порождает `hired_employees` и НЕ двигает эстафету.
- [ ] Существующий sheets-sync продолжает писать `hired_employees` без конфликта (источник различается).
- [ ] `tsc`/`lint` чисты; дашборды/воронка не сломаны.

---

## 2. Изменения в базе данных

```sql
-- ── 2.1 vacancies: статус «Стажировка»/«Отмена» + группа позиций (эстафета) ──
-- status расширяем: 'probation' (Стажировка, промежуточный, позиция НЕ
-- укомплектована) и 'cancelled' (Отмена — закрыли НАВСЕГДА без найма, ≠ paused).
ALTER TABLE public.vacancies DROP CONSTRAINT IF EXISTS vacancies_status_check;
ALTER TABLE public.vacancies ADD CONSTRAINT vacancies_status_check
  CHECK (status IN ('draft', 'active', 'probation', 'paused', 'closed', 'cancelled'));
-- 'cancelled' НЕ найм: триггеры hired_employees и эстафеты на 'cancelled' НЕ
-- срабатывают (только на closed/probation и closed соответственно).

-- Группа позиций из одной мульти-заявки (для эстафеты дат) + порядок в очереди.
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS position_group_id UUID,
  ADD COLUMN IF NOT EXISTS queue_index INTEGER;
CREATE INDEX IF NOT EXISTS idx_vacancies_position_group
  ON public.vacancies (position_group_id, queue_index)
  WHERE position_group_id IS NOT NULL;

-- ── 2.2 hired_employees: источник (sheets/app) + nullable sheet_row_id ───────
-- Сейчас sheet_row_id NOT NULL UNIQUE (дедуп Sheets). Для записей из приложения
-- ключа строки листа нет → делаем nullable и дедупим по (vacancy_id, status).
ALTER TABLE public.hired_employees
  ALTER COLUMN sheet_row_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sheets'
    CHECK (source IN ('sheets', 'app'));
-- Дедуп app-записей: одна строка на (vacancy_id, status) среди source='app'.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hired_employees_app_vacancy_status
  ON public.hired_employees (vacancy_id, status)
  WHERE source = 'app';

-- ── 2.3 Триггер: авто-создание hired_employees при закрытии/стажировке ───────
CREATE OR REPLACE FUNCTION public.auto_hired_employee_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_name TEXT;
BEGIN
  -- Реагируем только на closed (employee/hired) или probation (intern/probation).
  -- 'cancelled' сюда не попадает → фантомных нанятых нет.
  IF NEW.status NOT IN ('closed', 'probation') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_manager_name
  FROM public.user_profiles WHERE id = NEW.manager_id;

  INSERT INTO public.hired_employees
    (sheet_row_id, vacancy_id, position_name, hired_date, employment_type, status, manager_name_sheet, source, synced_at)
  VALUES (
    NULL,
    NEW.id,
    NEW.title,
    COALESCE(NEW.closed_at, CURRENT_DATE),
    CASE WHEN NEW.status = 'closed' THEN 'employee' ELSE 'intern' END,
    CASE WHEN NEW.status = 'closed' THEN 'hired' ELSE 'probation' END,
    v_manager_name,
    'app',
    NOW()
  )
  ON CONFLICT (vacancy_id, status) WHERE source = 'app' DO UPDATE
    SET hired_date = EXCLUDED.hired_date, synced_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_hired_employee
  AFTER UPDATE OF status ON public.vacancies
  FOR EACH ROW
  WHEN (NEW.status IN ('closed', 'probation') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.auto_hired_employee_on_status();

-- ── 2.4 Триггер: эстафета дат внутри группы позиций ──────────────────────────
CREATE OR REPLACE FUNCTION public.relay_position_group_open_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_id UUID;
BEGIN
  -- Только закрытие (closed) двигает дату. 'cancelled' не источник эстафеты.
  IF NEW.position_group_id IS NULL OR NEW.status <> 'closed' OR NEW.closed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RETURN NEW; -- уже было закрыто, повторно не двигаем
  END IF;

  -- Следующая АКТИВНАЯ позиция группы по очереди (queue_index > закрытой).
  -- cancelled/closed/paused пропускаются (цель только status='active').
  SELECT id INTO v_next_id
  FROM public.vacancies
  WHERE position_group_id = NEW.position_group_id
    AND status = 'active'
    AND queue_index > NEW.queue_index
  ORDER BY queue_index
  LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE public.vacancies SET opened_at = NEW.closed_at WHERE id = v_next_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_relay_position_group
  AFTER UPDATE OF status ON public.vacancies
  FOR EACH ROW
  WHEN (NEW.position_group_id IS NOT NULL AND NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.relay_position_group_open_date();
```

> RLS-изменения не требуются (новых таблиц нет; `vacancies` уже под RLS: `vacancies_write` FOR ALL head/admin + request-политики). Триггеры SECURITY DEFINER пишут в обход RLS — как существующий `auto_create_bonus_on_close`. Все функции с `SET search_path = public` (соответствие SEC-005).

---

## 3. Изменения в API

#### `POST /api/vacancies/requests` (расширение существующего)
**Описание:** создание заявки на вакансию. **Авторизация:** authenticated (manager — только себе в `manager_id`).
Добавить в `vacancyRequestCreateSchema`:
```ts
customer_name: z.string().max(200).nullable().optional(),
positions_count: z.number().int().min(1).max(100).default(1), // уже в схеме — пробросить в форму + INSERT
priority: z.enum(['высокий', 'средний', 'низкий']).nullable().optional(),
```
**Запрос:**
```json
{ "title": "Продавец", "location": "Сочи", "subdivision": "Розница",
  "customer_name": "Иванов И.", "positions_count": 3, "priority": "высокий",
  "manager_id": "<uuid>", "confidentiality": "open", "request_reason": "расширение штата" }
```
**Ответ 200/201:** `{ "data": { "id": "<uuid>", "status": "draft", "request_status": "pending", "positions_count": 3 } }`
**Ответ ошибки:** `{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }`

#### `PATCH /api/vacancies/requests/[id]/activate` (расширение)
**Описание:** активация одобренной заявки. **Авторизация:** автор заявки ИЛИ head/admin.
- `positions_count = 1` → как сейчас (UPDATE draft → active, `opened_at = COALESCE(opened_at, today)`).
- `positions_count = N > 1` →
  - исходной строке: `position_group_id = gen_random_uuid()`, `queue_index = 1`, `status = 'active'`, `opened_at = today`;
  - вставить (N−1) копий: те же поля, `queue_index = 2..N`, `status = 'active'`, `opened_at = today`, тот же `position_group_id`;
  - open: `hh_vacancy_id` — только у первой (EC-13); confidential: `internal_ref` на каждую через `gen_internal_ref()`.
**Ответ 200:** `{ "data": { "group_id": "<uuid>", "created": 3, "status": "active" } }`
**Ошибки:** `409 NOT_APPROVED`, `409 ACTIVATION_BLOCKED` (триггер `enforce_request_approval`), `409 DUPLICATE_HH_ID`, `400 HH_ID_REQUIRED`.

#### `PATCH /api/vacancies/[id]` (расширение)
**Описание:** правка вакансии. Разрешить смену `status` в `probation`/`cancelled` и обратно (active↔probation; active|probation→closed/cancelled; active→paused); принять `customer_name`, `positions_count` (одиночная), `priority`. Перевод в `closed` ставит `closed_at` (если не задан — today) → срабатывают триггеры.
**Запрос:** `{ "status": "probation" }` · `{ "status": "closed", "closed_at": "2026-03-10" }` · `{ "status": "cancelled" }`

#### `GET /api/vacancies/requests/options` (новый — автодополнение)
**Описание:** источник datalist. **Авторизация:** authenticated.
**Ответ 200:** `{ "data": { "titles": ["..."], "locations": ["..."], "subdivisions": ["..."] } }` — DISTINCT непустые значения из `vacancies` (TOP-200).

> Прочие эндпоинты (`approve`/`reject`/`GET list`) — без изменений.

---

## 4. Изменения в UI

### Новые/изменённые компоненты
| Компонент | Путь | Что |
|---|---|---|
| VacancyRequestForm (изм.) | `src/components/vacancy-requests/VacancyRequestForm.tsx` | +поля customer_name, positions_count, priority; datalist-автодополнение (titles/locations/subdivisions из options) |
| ActivateModal (изм.) | `src/components/vacancy-requests/ActivateModal.tsx` | подсказка «создастся N позиций» при positions_count>1 |
| AdminVacanciesClient (изм.) | `src/components/vacancies/AdminVacanciesClient.tsx` | статусы «Стажировка» и «Отмена» в селекте; колонки customer_name/priority; индикатор группы (queue 2/3) |
| VacancyStatusCell (изм.) | в AdminVacanciesClient | переходы в/из probation; в cancelled (active/probation→cancelled) |

### Состояния
- **Loading:** Skeleton (как сейчас).
- **Empty:** текст «Заявок нет» / «Вакансий нет».
- **Error:** `toast.error` по `error.message`.

---

## 5. Business Logic

### Статусы вакансии
| Статус | Смысл | Укомплектованность |
|---|---|---|
| draft | черновик заявки | — |
| active (Открыта) | идёт поиск | ПУСТАЯ |
| probation (Стажировка) | стажёр учится, не трудоустроен | ПУСТАЯ |
| closed (Закрыта) | нанят | УКОМПЛЕКТОВАНА |
| paused (Приостановлена) | временная пауза, вернёмся к поиску | не считается |
| cancelled (Отмена) | закрыли НАВСЕГДА без найма | НЕ найм, не считается |

Переходы: active↔probation; active|probation→closed; active→paused; active→cancelled; probation→cancelled.
**Отмена ≠ пауза** (бизнес-различие для метрик). `cancelled` не порождает hired_employees и не участвует в эстафете (EC-21/22).

### Эстафета дат — триггер `relay_position_group_open_date`
Группа из N позиций (`position_group_id`, `queue_index` 1..N). Все открыты одной датой. При закрытии позиции i → следующая активная (queue_index > i) получает `opened_at = closed_at` закрытой. Отменённые/закрытые/приостановленные пропускаются (цель — только `status='active'`).

### hired_employees — триггер `auto_hired_employee_on_status`
closed→employee/hired; probation→intern/probation. `hired_date = closed_at ?? today`. Дедуп по (vacancy_id, status) для source='app'. sheets-sync (source='sheets') не конфликтует. **`cancelled` НЕ порождает hired_employees** → фантомных нанятых нет.

### Интеграции
Внешних нет. HH-привязка (`hh_vacancy_id`) — как сейчас (одно поле; мульти-HH отложено).

---

## 6. Edge Cases

| # | Ситуация | Поведение системы |
|---|----------|-------------------|
| 1 | `positions_count=0` или >100 | 422 VALIDATION_ERROR (схема 1–100) |
| 2 | Активация заявки с `positions_count=1` | один UPDATE, без группы (`position_group_id=NULL`) |
| 3 | Активация `positions_count=3`, open, один hh_vacancy_id | hh_id у первой; остальные открыты без hh_id — НЕ падать (см. EC-13) |
| 4 | Закрытие первой позиции группы | вторая.`opened_at` = `closed_at` первой (эстафета) |
| 5 | Закрытие позиций НЕ по порядку (#2 раньше #1) | следующая активная по queue_index > 2 (т.е. #3) получает дату; #1 не трогается |
| 6 | Закрытие последней позиции группы | следующей нет → эстафета ничего не делает |
| 7 | Приостановка (paused) позиции из группы | не цель и не источник эстафеты; пропускается |
| 8 | Повторное закрытие уже закрытой | триггеры не срабатывают (OLD.status='closed') — дублей hired_employees и сдвигов дат нет |
| 9 | active→probation→active (стажёр сорвался) | probation создаёт hired_employees(intern); возврат в active — позиция снова ПУСТАЯ; intern-запись остаётся (история) |
| 10 | probation→closed (стажёр трудоустроен) | создаётся hired_employees(employee/hired); intern-запись остаётся; дедуп (vacancy_id,status) различает intern и employee |
| 11 | closed без `closed_at` | триггер ставит `hired_date=today`; closed_at стоит выставлять в API (today) |
| 12 | sheets-sync и app пишут одну вакансию | разные `source` → дедуп-индексы независимы, конфликта нет |
| 13 | Активация группы, hh_id обязателен (open) для каждой | РЕШЕНИЕ: требовать hh_id только у первой; сиблинги — open без hh_id до ручной привязки. Зафиксировать в коде |
| 14 | Самосогласование (executive свою заявку) | 403 (API) + RLS — без изменений |
| 15 | Активация неодобренной заявки | 409 NOT_APPROVED (триггер `enforce_request_approval`) — без изменений |
| 16 | Автодополнение: новое значение (нет в datalist) | принимается как есть (свободный ввод) |
| 17 | `priority` вне набора | NULL (как sheets-sync: только высокий/средний/низкий) |
| 18 | Группа: одну позицию удалили (delete) | `hired_employees.vacancy_id ON DELETE SET NULL`; эстафета по оставшимся active |
| 19 | opened_at задан вручную head при активации | не перезатираем (используем заданный, не today) |
| 20 | Дашборд-фильтр «активные» (hh_vacancy_id IS NOT NULL) и probation | probation без hh_id не попадает в «активные с hh_id»; для штатки probation = не укомплектована (спека #2) |
| 21 | Отмена позиции: active/probation → `cancelled` | hired_employees НЕ создаётся (триггер только на closed/probation) → нет фантомного найма; эстафета НЕ двигается (relay только на closed); cancelled пропускается и как источник, и как цель (цель — `status='active'`) |
| 22 | Отмена позиции в группе, потом закрывается соседняя | эстафета идёт по оставшимся `active` (cancelled пропущена); даты соседних не зависят от отменённой |

---

## 7. Файлы, которые будут затронуты

### Новые файлы
- `supabase/migrations/<ts>_vacancy_entry.sql` — §2 (status CHECK, position_group_id/queue_index, hired_employees source+nullable, 2 триггера).
- `src/app/api/vacancies/requests/options/route.ts` — datalist-источник.

### Изменяемые файлы
- `src/lib/validations.ts` — `vacancyRequestCreateSchema` (+customer_name, priority; positions_count уже есть); схема PATCH vacancy (+probation/cancelled, customer_name, priority).
- `src/app/api/vacancies/requests/route.ts` — проброс новых полей в INSERT.
- `src/app/api/vacancies/requests/[id]/activate/route.ts` — создание N строк + group_id/queue_index + opened_at=today.
- `src/app/api/vacancies/[id]/route.ts` — разрешить probation/cancelled/closed+closed_at, новые поля.
- `src/components/vacancy-requests/VacancyRequestForm.tsx` — поля + datalist.
- `src/components/vacancy-requests/ActivateModal.tsx` — подсказка N позиций.
- `src/components/vacancies/AdminVacanciesClient.tsx` + VacancyStatusCell — статусы probation/cancelled, колонки, индикатор группы.
- `src/types/database.ts` — vacancies (+position_group_id, queue_index), hired_employees (+source, sheet_row_id nullable), status union (+probation, +cancelled).
- `src/types/index.ts` — VacancyStatus (+'probation', +'cancelled').

### НЕ трогать
- sheets-sync (`sync/sheets/route.ts`) — продолжает писать hired_employees с source='sheets'.
- staffing (`compute_staffing_plan`, `/staffing/*`) — отдельная спека #2 (розница/компания по subdivision).
- мульти-HH, `lib/hh-api.ts`, `scripts/sync-hh.ts` — без изменений.

---

## 8. Verification (после реализации)

1. **Миграция:** `supabase migration new <name>` → `db push`; `get_advisors(security)` — без новых ERROR.
2. **tsc/lint:** `npx tsc --noEmit` = 0; `npm run lint` = 0.
3. **Эстафета:** заявка positions_count=3 → approve → activate → 3 строки active одной датой; закрыть #1 (closed_at) → #2.opened_at = эта дата; закрыть #2 → #3.opened_at.
4. **hired_employees:** закрытие → запись source='app', employee/hired; probation → intern/probation; повторное закрытие — без дублей; **cancelled → записи НЕТ**.
5. **Sheets-совместимость:** прогон sheets-sync → source='sheets' не конфликтует с app.
6. **Дашборд/воронка:** `/dashboard`, `/vacancies/[id]` — счётчики hired/interns не сломаны.
7. **Негатив:** активация неодобренной → 409; самосогласование executive → 403.
