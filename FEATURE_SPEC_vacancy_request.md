# Feature: Форма заявки на вакансию (Vacancy Request)

> **Проект:** Yamaguchi Sales Intelligence Platform
> **Дата:** 2026-05-26
> **Приоритет:** High
> **Оценка:** 1 день

---

## 1. User Story

**Как** HR-менеджер,
**я хочу** подать заявку на открытие вакансии до её публикации на HH,
**чтобы** зафиксировать дату открытия, причину и тип (открытая/конфиденциальная), получить акцепт руководителя, а HH ID привязать позже.

### Сценарий использования
1. HR открывает раздел «Заявки» → нажимает «Новая заявка»
2. **Выбирает город** → система показывает виджет штатной сверки (план/занято/в работе/вакантно по должностям этого города) — см. раздел «Штатная сверка»
3. Заполняет форму: название, подразделение, дата открытия, причина (свободный текст), конфиденциальность, менеджер-исполнитель
4. Сохраняет → создаётся запись `vacancies` со `status='draft'`, `request_status='pending'`
5. Sales Director или HR-head видит заявку в списке «На согласовании»
6. Руководитель нажимает «Согласовать» (или «Отклонить» с комментарием)
7. При согласовании → `request_status='approved'`, заявка готова к публикации
8. **Активация — две ветки в зависимости от конфиденциальности:**
   - **Открытая** (`confidentiality='open'`): вакансия размещена на HH → HR вписывает `hh_vacancy_id` → `status='active'`
   - **Конфиденциальная** (`confidentiality='confidential'`): на HH не публикуется → система генерирует `internal_ref` (CONF-2026-NNNN) → `status='active'` без HH ID
9. С этого момента заявка участвует в аналитике как обычная вакансия

### Критерии приёмки
- [ ] HR может создать заявку без HH ID (поле опционально на этом этапе)
- [ ] Заявка создаётся со `status='draft'` и `request_status='pending'`
- [ ] Только `executive` (Sales Director) или `head` (HR-head) могут согласовать/отклонить
- [ ] HR не может согласовать собственную заявку
- [ ] Открытая заявка: привязка `hh_vacancy_id` переводит `status` в `'active'` только если `request_status='approved'`
- [ ] Конфиденциальная заявка: активируется без HH ID, система генерирует `internal_ref`
- [ ] При выборе города показывается актуальная штатная сверка
- [ ] Превышение штата предупреждает, но не блокирует создание заявки
- [ ] Заявки в статусе `draft` НЕ попадают в KPI и активную аналитику
- [ ] Отклонённая заявка остаётся видимой с причиной отклонения
- [ ] Все действия (создание/согласование/отклонение/привязка) пишутся в `audit_logs`

---

## 2. Изменения в базе данных

> Новых таблиц не создаём. Заявка — это `vacancies` со `status='draft'`. Расширяем существующую таблицу.

### Изменения в существующих таблицах
```sql
-- Новые поля для механики заявки
ALTER TABLE vacancies ADD COLUMN request_reason TEXT
  CHECK (request_reason IS NULL OR char_length(request_reason) <= 1000);

ALTER TABLE vacancies ADD COLUMN confidentiality TEXT NOT NULL DEFAULT 'open'
  CHECK (confidentiality IN ('open', 'confidential'));

ALTER TABLE vacancies ADD COLUMN request_status TEXT
  CHECK (request_status IS NULL OR request_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE vacancies ADD COLUMN requested_by UUID REFERENCES user_profiles(id);

ALTER TABLE vacancies ADD COLUMN approved_by UUID REFERENCES user_profiles(id);

ALTER TABLE vacancies ADD COLUMN approved_at TIMESTAMPTZ;

ALTER TABLE vacancies ADD COLUMN rejection_reason TEXT
  CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500);

-- Внутренний ключ для конфиденциальных вакансий (нет и не будет hh_vacancy_id)
ALTER TABLE vacancies ADD COLUMN internal_ref TEXT UNIQUE
  CHECK (internal_ref IS NULL OR internal_ref ~ '^CONF-\d{4}-\d{4}$');

-- Город для штатной сверки уже существует как vacancies.location — НЕ создаём дубль.
-- Штатная сверка группирует по существующему полю location.

-- Генератор internal_ref: CONF-{год}-{последовательный номер}
CREATE SEQUENCE IF NOT EXISTS conf_vacancy_seq;
CREATE OR REPLACE FUNCTION gen_internal_ref()
RETURNS TEXT AS $$
BEGIN
  RETURN 'CONF-' || to_char(NOW(), 'YYYY') || '-'
         || lpad(nextval('conf_vacancy_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Индекс для быстрой выборки заявок на согласование
CREATE INDEX idx_vacancies_request_status ON vacancies(request_status)
  WHERE request_status IS NOT NULL;

-- Защита целостности: нельзя перевести в active без согласования
-- (реализуется триггером, т.к. CHECK не видит переходы состояний)
CREATE OR REPLACE FUNCTION enforce_request_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN
    -- Должна быть согласована
    IF NEW.request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Нельзя активировать вакансию без согласования заявки';
    END IF;
    -- Открытая обязана иметь HH ID; конфиденциальная — internal_ref
    IF NEW.confidentiality = 'open' AND NEW.hh_vacancy_id IS NULL THEN
      RAISE EXCEPTION 'Открытая вакансия требует hh_vacancy_id для активации';
    END IF;
    IF NEW.confidentiality = 'confidential' AND NEW.internal_ref IS NULL THEN
      NEW.internal_ref := gen_internal_ref();  -- автогенерация если не задан
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_request_approval
  BEFORE UPDATE ON vacancies
  FOR EACH ROW EXECUTE FUNCTION enforce_request_approval();
```

### RLS-политики
```sql
-- HR (manager/head) видят свои заявки; executive/head видят все
CREATE POLICY "vacancies_request_select"
  ON vacancies FOR SELECT
  USING (
    requested_by = auth.uid()
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('executive', 'head', 'admin')
  );

-- Создавать заявку может любой авторизованный HR
CREATE POLICY "vacancies_request_insert"
  ON vacancies FOR INSERT
  WITH CHECK (requested_by = auth.uid());

-- Согласовывать может только executive или head, и не свою заявку
CREATE POLICY "vacancies_request_approve"
  ON vacancies FOR UPDATE
  USING (
    (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('executive', 'head', 'admin')
  );
```

---

## 3. Изменения в API

#### `POST /api/vacancies/requests`
**Описание:** Создать заявку на вакансию | **Авторизация:** Требуется (любой HR)
**Запрос:**
```json
{
  "title": "Продавец-консультант в YAMAGUCHI",
  "department": "Розница",
  "subdivision": "Сочи",
  "location": "Сочи",
  "manager_id": "uuid",
  "opened_at": "2026-06-01",
  "request_reason": "Расширение штата, открытие новой точки в ТЦ Моремолл",
  "confidentiality": "open",
  "positions_count": 2
}
```
**Ответ 200:** `{ "data": { "id": "uuid", "status": "draft", "request_status": "pending" } }`
**Ответ ошибки:** `{ "error": { "code": "VALIDATION_ERROR", "message": "Название обязательно" } }`

#### `GET /api/staffing/availability?location=Сочи`
**Описание:** Штатная сверка по городу (для виджета в форме заявки) | **Авторизация:** Требуется
**Ответ 200:**
```json
{
  "data": {
    "location": "Сочи",
    "rows": [
      { "position_name": "Продавец-консультант", "planned": 8, "occupied": 5, "in_progress": 1, "vacant": 2 },
      { "position_name": "Руководитель филиала", "planned": 1, "occupied": 1, "in_progress": 0, "vacant": 0 }
    ]
  }
}
```
> Зависит от таблицы `staffing_plan` (FEATURE_SPEC «Штатное расписание»). Если штат ещё не загружен — возвращает пустой rows, виджет показывает «Штат по городу не задан».

#### `PATCH /api/vacancies/requests/[id]/approve`
**Описание:** Согласовать заявку | **Авторизация:** Только `executive`/`head`/`admin`
**Запрос:** `{}` (пустое тело)
**Ответ 200:** `{ "data": { "id": "uuid", "request_status": "approved", "approved_by": "uuid" } }`
**Ответ ошибки:** `{ "error": { "code": "FORBIDDEN", "message": "Нельзя согласовать собственную заявку" } }`

#### `PATCH /api/vacancies/requests/[id]/reject`
**Описание:** Отклонить заявку | **Авторизация:** Только `executive`/`head`/`admin`
**Запрос:** `{ "rejection_reason": "Нет бюджета на Q2" }`
**Ответ 200:** `{ "data": { "id": "uuid", "request_status": "rejected" } }`

#### `PATCH /api/vacancies/requests/[id]/activate`
**Описание:** Активировать согласованную заявку. Две ветки по confidentiality. | **Авторизация:** HR-автор или head
**Запрос (открытая):** `{ "hh_vacancy_id": "131739178" }`
**Запрос (конфиденциальная):** `{}` — HH ID не нужен, internal_ref генерится автоматически
**Ответ 200 (открытая):** `{ "data": { "id": "uuid", "status": "active", "hh_vacancy_id": "131739178" } }`
**Ответ 200 (конфиденциальная):** `{ "data": { "id": "uuid", "status": "active", "internal_ref": "CONF-2026-0042" } }`
**Ответы ошибок:**
- `{ "error": { "code": "NOT_APPROVED", "message": "Заявка ещё не согласована" } }`
- `{ "error": { "code": "HH_ID_REQUIRED", "message": "Открытая вакансия требует HH ID" } }`
- `{ "error": { "code": "DUPLICATE_HH_ID", "message": "Вакансия с этим HH ID уже существует" } }`

### Изменения в существующих эндпоинтах
- `GET /api/vacancies`: добавить опциональный фильтр `?request_status=pending` для списка заявок на согласование
- Sheets-sync (`/api/sync/sheets`): **не трогать** — он работает только с `active`/`closed`, заявки в `draft` его не касаются

---

## 4. Изменения в UI

### Новые экраны/компоненты
| Компонент | Путь/Расположение | Что показывает |
|-----------|-------------------|----------------|
| `VacancyRequestForm` | Модалка по кнопке «Новая заявка» | Форма создания заявки |
| `StaffingCheckWidget` | Внутри формы, под селектором города | Таблица план/занято/в работе/вакантно по должностям |
| `VacancyRequestList` | Раздел «Заявки» в дашборде | Список заявок с фильтром по статусу |
| `ApprovalActions` | Внутри карточки заявки | Кнопки «Согласовать»/«Отклонить» (только для руководителя) |
| `ActivateModal` | Кнопка «Активировать» на согласованной заявке | Открытая: поле HH ID. Конфиденциальная: подтверждение без HH ID |

### Изменения в существующих экранах
| Экран | Что меняется |
|-------|-------------|
| Дашборд (sidebar) | Добавить пункт меню «Заявки» с бейджем количества `pending` |
| Список вакансий | Добавить фильтр-таб «Заявки (draft)» отдельно от активных |

### Состояния
- **Loading:** скелетон карточек заявок
- **Empty:** «Заявок на согласование нет» / «Вы ещё не подавали заявок»
- **Error:** тост с текстом ошибки, форма не сбрасывается

---

## 5. Business Logic

### Правила
- **Создание заявки:** `status='draft'`, `request_status='pending'`, `requested_by=auth.uid()`, `hh_vacancy_id=NULL`. Если нарушено — 400.
- **Согласование:** только `executive`/`head`/`admin`; нельзя согласовать заявку где `requested_by = auth.uid()` → 403. При успехе: `request_status='approved'`, `approved_by`, `approved_at=now()`.
- **Отклонение:** только руководитель; `rejection_reason` обязателен; `request_status='rejected'`. Заявка остаётся видимой.
- **Активация открытой:** разрешена только если `request_status='approved'`; требует `hh_vacancy_id`; переводит `status='active'`; триггер БД страхует от обхода.
- **Активация конфиденциальной:** разрешена только если `request_status='approved'`; HH ID не требуется; система генерирует `internal_ref` (CONF-ГГГГ-NNNN); переводит `status='active'`.
- **Штатная сверка:** при выборе города форма запрашивает `/api/staffing/availability`; превышение плана (`vacant <= 0`) показывает предупреждение, но не блокирует.
- **Аналитика:** заявки в `draft` исключены из всех KPI-запросов (фильтр `status IN ('active','closed')`). Конфиденциальные в `active`/`closed` считаются как обычные.

### Интеграции
- **Сервис:** Telegram-бот (опционально) — уведомление руководителю о новой заявке на согласование
- **Что отправляем:** title, requested_by, opened_at, reason
- **При ошибке:** заявка всё равно создаётся, уведомление — best-effort

---

## 6. Edge Cases

| # | Ситуация | Поведение системы |
|---|----------|-------------------|
| 1 | HR пытается согласовать свою же заявку | 403, «Нельзя согласовать собственную заявку» |
| 2 | Привязка HH к несогласованной заявке | 409, «Заявка ещё не согласована» |
| 3 | Привязываемый hh_vacancy_id уже есть в БД | 409, «Вакансия с этим HH ID уже существует» |
| 4 | Заявку пытаются активировать минуя API (прямой UPDATE) | Триггер БД блокирует переход draft→active без approved |
| 5 | Отклонение без причины | 400, поле `rejection_reason` обязательно |
| 6 | manager_id указывает на неактивного сотрудника | 400, «Менеджер неактивен» |
| 7 | Sheets-sync встречает draft-заявку | Игнорирует (синк работает с active/closed) |
| 8 | Повторное согласование уже одобренной заявки | Идемпотентно: возвращает текущее состояние, 200 |
| 9 | Конфиденциальная активируется без HH ID | Норма: генерится internal_ref, status='active' |
| 10 | Открытая активируется без HH ID | 400, «Открытая вакансия требует HH ID» |
| 11 | Выбран город, по которому нет штата в staffing_plan | Виджет показывает «Штат по городу не задан», заявка создаётся |
| 12 | Заявка превышает план штата (vacant ≤ 0) | Предупреждение в форме, создание разрешено |
| 13 | Коллизия internal_ref (теоретически) | UNIQUE-constraint + sequence гарантируют уникальность |

---

## 7. Файлы, которые будут затронуты

> Этот раздел помогает Claude Code понять scope изменений и ничего не забыть.

### Новые файлы
- `components/vacancy-requests/VacancyRequestForm.tsx` — форма создания заявки
- `components/vacancy-requests/VacancyRequestList.tsx` — список заявок
- `components/vacancy-requests/ApprovalActions.tsx` — кнопки согласования
- `components/vacancy-requests/LinkHhModal.tsx` — модалка привязки HH ID
- `app/(app)/requests/page.tsx` — страница раздела «Заявки»
- `app/api/vacancies/requests/route.ts` — POST создание
- `app/api/vacancies/requests/[id]/approve/route.ts` — согласование
- `app/api/vacancies/requests/[id]/reject/route.ts` — отклонение
- `app/api/vacancies/requests/[id]/link-hh/route.ts` — привязка HH
- `lib/validations/vacancy-request.ts` — Zod-схемы

### Изменяемые файлы
- `types/index.ts` — добавить новые поля vacancies в типы
- `components/layout/Sidebar.tsx` — пункт меню «Заявки» с бейджем
- `app/(app)/vacancies/page.tsx` — фильтр-таб для draft
- `lib/kpi.ts` + запросы дашборда — исключить draft из KPI
- ⚠️ **КРИТИЧНО:** запросы с фильтром `google_sheet_row IS NOT NULL` (дашборд подразделений, воронка — SPEC стр. 2825, 3935). Расширить фильтр, чтобы заявочные и конфиденциальные вакансии попадали в аналитику: `(google_sheet_row IS NOT NULL OR internal_ref IS NOT NULL OR requested_by IS NOT NULL)`
- `supabase/migrations/20260526_vacancy_requests.sql` — миграция полей + RLS + триггер активации

### НЕ трогать (защита от регрессий)
- `app/api/sync/sheets/route.ts` и `lib/google-sheets.ts` — sheets-sync остаётся как есть
- Существующий триггер `audit_vacancies` — аудит заявок работает через него автоматически (CLAUDE.md правило №10), ручной аудит НЕ добавлять
- `/staffing` + `staffing_records` — это «Укомплектованность» (ручной %), НЕ путать со штатным расписанием
- Логика бонусов, KPI закрытых вакансий, hh_manager_stats
