# FEATURE_SPEC #3 — Сводная таблица вакансий в стиле Google Sheets «Data»

> **Проект:** HR Control Tower · **Дата:** 2026-05-31 · **Приоритет:** High · **Оценка:** 1.5–2 дня
> **Статус:** проектирование завершено (сверено с живой БД 2026-05-31).
> **Зависимости:** спеки #1 (статусы probation/cancelled, эстафета мульти-позиций) и #2 (привязка к штатке) — в проде.
> **Вне scope:** мульти-менеджеры (M2M) — спека #4; дроп колонки `department` — поздняя миграция; синк новых полей из Google Sheets/XLSX-импорта — отдельно.

---

## 1. User Story

**Как** руководитель HR, **я хочу** видеть и вести вакансии в `/vacancies/admin` в том же виде, что моя рабочая Google-таблица «Data» (16 колонок по порядку, цвет строки по статусу, цветной приоритет, смена статуса и правка ячеек прямо в таблице), **чтобы** система стала единым центром управления вакансиями и заменила ручную таблицу.

### Сценарий
1. Открываю `/vacancies/admin` → таблица с 16 колонками в порядке Data; строки подкрашены по статусу, приоритет — цветным бейджем.
2. Меняю статус вакансии прямо в строке (popover, как сейчас); при `closed` — выбор даты закрытия → TTF считается БД автоматически.
3. Двойным кликом правлю текстовые ячейки (Название, Пояснение, Заказчик, Кол-во, ФИО кандидата, Комментарий, Подразделение).
4. Фильтрую по подразделению (Select из живых значений) — вижу только Розницу/Бэк офис/и т.д.
5. Создаю вакансию через модалку — задаю в т.ч. Подразделение, Причину появления, Пояснение.
6. «Причина появления» — структурированный enum (фильтруемый), «Пояснение» — свободный текст рядом (деталь).

### Критерии приёмки
- [ ] Миграция: добавлены `appearance_reason` (enum), `explanation`, `candidate_name`, `comment`; `department` помечен DEPRECATED (не дропнут).
- [ ] Ни один API-путь (создание / заявка / активация) больше не пишет `department`; `VacancyForm` пишет `subdivision` (баг устранён).
- [ ] `/vacancies/admin` показывает 16 колонок в порядке Data; строки окрашены по `status`; приоритет цветной; пустой `priority` → нейтральный, не падает.
- [ ] Сохранены inline-edit статуса (`VacancyStatusCell`) и двойной клик по редактируемым ячейкам.
- [ ] Фильтр по подразделению (`eq`) + поле «Подразделение» в модалке создания (datalist).
- [ ] `appearance_reason` отображается по-русски (RU-маппинг), хранится как enum-код.
- [ ] TTF: закрытая → `days_to_close`; открытая → серое «N в работе» (today−opened_at).
- [ ] `tsc` 0, `lint` 0, тесты `AdminVacanciesClient.test.tsx` обновлены и зелёные.

---

## 2. Изменения в базе данных

```sql
-- ── 2.1 Enum причины появления вакансии ─────────────────────────────────────
CREATE TYPE public.appearance_reason AS ENUM
  ('dismissal', 'replacement', 'expansion', 'internal_transfer', 'other');

-- ── 2.2 Новые поля vacancies ────────────────────────────────────────────────
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS appearance_reason public.appearance_reason,  -- Причина появления (структура, фильтры)
  ADD COLUMN IF NOT EXISTS explanation       text,                      -- Пояснение (свободный текст, пара к причине)
  ADD COLUMN IF NOT EXISTS candidate_name    text,                      -- ФИО нанятого кандидата (строкой)
  ADD COLUMN IF NOT EXISTS comment           text;                      -- Комментарий (≠ request_reason)

-- Лимиты длины (как в Zod, защита на уровне БД)
ALTER TABLE public.vacancies
  ADD CONSTRAINT vacancies_explanation_len    CHECK (explanation    IS NULL OR char_length(explanation)    <= 2000),
  ADD CONSTRAINT vacancies_candidate_name_len CHECK (candidate_name IS NULL OR char_length(candidate_name) <= 200),
  ADD CONSTRAINT vacancies_comment_len        CHECK (comment        IS NULL OR char_length(comment)        <= 2000);

-- ── 2.3 Депрекация department (данные пусты на 100%, миграция данных НЕ нужна) ─
COMMENT ON COLUMN public.vacancies.department IS
  'DEPRECATED 2026-05-31 (FEATURE_SPEC #3): каноническое поле подразделения — subdivision. Не писать. Дроп — отдельной поздней миграцией после удаления всех ссылок.';
```

> **RLS:** не меняется. `vacancies` уже под RLS (политики `vacancies_*`), новые колонки покрываются построчными политиками автоматически; column-level grants не требуются. Новых таблиц/функций нет → advisor-регресса (SEC-001) быть не может, но прогнать `get_advisors(security)` после push.
> **TTF:** `days_to_close` уже `GENERATED ALWAYS AS (CASE WHEN closed_at IS NOT NULL THEN closed_at - opened_at ELSE NULL END) STORED` — НЕ трогаем.
> **Enum:** новое значение в будущем — `ALTER TYPE ... ADD VALUE` (не входит в #3).

---

## 3. Изменения в API

### 3.1 Zod-схемы (`src/lib/validations.ts`)

```typescript
// Переиспользуемая enum-схема причины появления
export const appearanceReasonSchema = z.enum(
  ['dismissal', 'replacement', 'expansion', 'internal_transfer', 'other'],
);

// Новые поля — добавить в vacancyCreateSchema, vacancyUpdateSchema, vacancyRequestCreateSchema:
appearance_reason: appearanceReasonSchema.nullable().optional(),
explanation:    z.string().max(2000).nullable().optional(),
candidate_name: z.string().max(200).nullable().optional(),
comment:        z.string().max(2000).nullable().optional(),

// vacancyAdminQuerySchema — фильтр по подразделению:
subdivision: z.string().max(100).optional(),
```

### 3.2 `GET /api/vacancies/admin` — фильтр + новые поля

**Параметры (доп.):** `?subdivision=<точное значение>` (eq).
**Логика:** `if (subdivision) query = query.eq('subdivision', subdivision);`
**Select (доп. поля):** `appearance_reason, explanation, candidate_name, comment` (плюс уже отдаваемые `subdivision, customer_name, priority, positions_count, days_to_close, confidentiality`).
**Ответ 200 (фрагмент строки):**
```json
{
  "data": [{
    "id": "uuid", "title": "Старший продавец", "location": "Сочи",
    "confidentiality": "open", "appearance_reason": "replacement",
    "explanation": "Декрет основного сотрудника", "subdivision": "Розница",
    "customer_name": "Иванов И.И.", "priority": "высокий", "positions_count": 1,
    "opened_at": "2026-05-01", "closed_at": null, "status": "active",
    "manager": { "id": "uuid", "full_name": "Петрова М." },
    "days_to_close": null, "candidate_name": null, "comment": "Срочно"
  }],
  "meta": { "total": 137, "page": 1, "per_page": 50 }
}
```
> Для `role='executive'` поля менеджера по-прежнему вырезаются (EC-09). Новые поля executive видит (не персональные).

### 3.3 `POST /api/vacancies` — создание (head/admin)

В тело и INSERT добавить `appearance_reason, explanation, candidate_name, comment, subdivision`.
**`department` больше не пишется** — строку `department: input.department ?? null` удалить (поле остаётся nullable в БД, пишется NULL по умолчанию).

### 3.4 `POST /api/vacancies/requests` и `PATCH .../activate`

- `requests` (создание заявки): добавить приём `appearance_reason/explanation` (опц.); **убрать запись `department`**; сиблинги в `activate` — **убрать наследование `department`** (наследуют `subdivision`, который уже есть).
- `PATCH /api/vacancies/[id]`: `vacancyUpdateSchema` уже прокидывает `parsed.data` в `.update()` → новые 4 поля и `subdivision` обновляются inline-редактированием без доп. кода (после расширения схемы).

### 3.5 Источник списка подразделений
`GET /api/vacancies/requests/options` (уже есть) — отдаёт `subdivisions` (uniq, ≤200). Используется и для datalist создания, и для Select-фильтра.

---

## 4. Изменения в UI

### 4.1 16 колонок `/vacancies/admin` (порядок Data)

| # | Колонка | Источник | Редактирование |
|---|---------|----------|----------------|
| 1 | Название | `title` | двойной клик (текст) |
| 2 | Город | `location` | двойной клик (текст) |
| 3 | Формат поиска | `confidentiality` → Открытый/Конфиденц. | бейдж (read; смена — в edit) |
| 4 | Причина появления | `appearance_reason` → RU | Select inline |
| 5 | Пояснение | `explanation` | двойной клик (текст) |
| 6 | Подразделение | `subdivision` | двойной клик + datalist |
| 7 | ФИО Заказчика | `customer_name` | двойной клик (текст) |
| 8 | Приоритет | `priority` | бейдж цветной (read; смена — в edit) |
| 9 | Кол-во | `positions_count` | двойной клик (число) |
| 10 | Дата открытия | `opened_at` | дата (read) |
| 11 | Дата закрытия | `closed_at` | через смену статуса на closed |
| 12 | Статус | `status` | **VacancyStatusCell (popover) — сохранить** |
| 13 | Менеджер | `manager.full_name` | (один; M2M → #4) |
| 14 | TTF (дни) | `days_to_close` / age | read (см. §5.3) |
| 15 | ФИО кандидата | `candidate_name` | двойной клик (текст) |
| 16 | Комментарий | `comment` | двойной клик (текст) |

### 4.2 Цвет строки по статусу
Перенести фон со span-бейджа на `<TableRow>`, приглушённая палитра (читаемость текста ячеек):
```typescript
const STATUS_ROW_VARIANTS: Record<string, string> = {
  active:    'bg-green-50',
  probation: 'bg-amber-50',
  paused:    'bg-yellow-50',
  closed:    'bg-slate-50 text-slate-500',
  cancelled: 'bg-red-50',
  draft:     'bg-blue-50',
};
```
Бейдж в колонке «Статус» сохраняет яркую палитру `STATUS_VARIANTS` (из #2) для контраста.

### 4.3 Цветной приоритет
```typescript
const PRIORITY_VARIANTS: Record<string, string> = {
  'высокий': 'bg-red-100 text-red-800',
  'средний': 'bg-yellow-100 text-yellow-800',
  'низкий':  'bg-green-100 text-green-800',
};
// пусто/неизвестное → бейдж не рисуется, ячейка показывает «—» (нейтрально)
```

### 4.4 Причина появления — RU-маппинг
```typescript
const APPEARANCE_REASON_LABELS: Record<string, string> = {
  dismissal: 'Увольнение', replacement: 'Замена', expansion: 'Расширение',
  internal_transfer: 'Внутр. перевод', other: 'Другое',
};
// NULL → «—»
```

### 4.5 Модалка создания + фильтр
- Поле «Подразделение» (Input + `datalist` из `subdivisions`); поля «Причина появления» (Select enum), «Пояснение» (Textarea) — опционально.
- Панель фильтров: Select «Подразделение» (`all` + значения) → `?subdivision=`.

### 4.6 Компактность (стиль Sheets)
- Таблица: `text-xs`, `[&_td]:py-1 [&_th]:py-1.5`, плотные строки; горизонтальный скролл-контейнер (`overflow-x-auto`) — 16 колонок широкие.
- Шрифт моноширинный для чисел (`tabular-nums`) в Кол-во/TTF/датах.

### 4.7 Фикс бага `VacancyForm`
Переключить поле формы с `department` на `subdivision`: имя поля, Zod-схема внутри формы, `initial`, submit-payload, label «Подразделение». Edit-страница уже селектит оба поля — читать `subdivision`.

### Состояния
- **Loading:** Skeleton-строки. **Empty:** «Вакансий нет.» **Error:** `toast.error(error.message)`.

---

## 5. Business Logic

### 5.1 Подразделение
Каноническое поле — `subdivision`. `department` депрецирован: не читается и не пишется UI/API после #3 (колонка остаётся как legacy). Данные не мигрируем (`department` пуст на 100%).

### 5.2 Причина + Пояснение
`appearance_reason` (enum) — структура для фильтров/аналитики; `explanation` (text) — свободная деталь. Работают в паре, оба опциональны и независимы от `request_reason` (последнее — обоснование заявки в workflow согласования, не отображается в таблице Data).

### 5.3 TTF (детерминированное правило, обе ветки)
- `closed_at` задан → показываем `days_to_close` (целое, `tabular-nums`).
- `closed_at = NULL` (вакансия открыта) → показываем серое `«{today − opened_at} в работе»` (вычисление на клиенте, визуально отличается от финального TTF: `text-muted-foreground`).
- `opened_at` в будущем (теоретически) → `0 в работе` (clamp ≥ 0).

### 5.4 Цвет строки и приоритета
Строка красится по `status` (§4.2). `draft` → голубой фон (`bg-blue-50`) — заявки-черновики визуально отделены. Приоритет: цвет по §4.3; пустой/неизвестный → без бейджа, «—».

### 5.5 Формат поиска
`confidentiality`: `open` → «Открытый», `confidential` → «Конфиденц.» (бейдж; для конфиденциальной можно добавить иконку замка `Lock`).

---

## 6. Edge Cases (критерии приёмки)

| # | Ситуация | Ожидаемое поведение |
|---|----------|---------------------|
| 1 | `priority` пустой (90 строк) | Бейдж не рисуется, ячейка «—»; **не падает** (нет ключа в `PRIORITY_VARIANTS`) |
| 2 | `priority` вне справочника (неизв. строка) | Трактуется как пустой → «—», нейтрально |
| 3 | `department` депрекация | Старые данные пусты → миграция данных не нужна; новые записи пишут NULL; UI/API не читают |
| 4 | `VacancyForm` правит подразделение | Пишется в `subdivision` (не в `department`) — данные не теряются |
| 5 | `appearance_reason = NULL` | Колонка «Причина появления» → «—» |
| 6 | `appearance_reason` неизвестный код (рассинхрон enum/маппинг) | Фолбэк: показать сырой код, не падать |
| 7 | TTF: вакансия открыта (`closed_at=NULL`) | Серое «N в работе» (today−opened_at), не «—» и не пусто |
| 8 | TTF: вакансия закрыта | `days_to_close` (целое) |
| 9 | Конфиденциальная вакансия | «Формат поиска» = «Конфиденц.» (+ иконка); строка красится по статусу как обычно |
| 10 | Строка `draft` | Фон `bg-blue-50`; статус-бейдж «Черновик»; inline-смена статуса доступна head/admin |
| 11 | Строка `closed` | Фон `bg-slate-50`, текст приглушён; TTF заполнен |
| 12 | `cancelled` | Фон `bg-red-50`; в укомплектованность (#2) по-прежнему дыра — здесь только отображение |
| 13 | Фильтр по подразделению + пустые `subdivision` (63) | `eq` по значению не вернёт пустые; для просмотра пустых — отдельного фильтра нет (только конкретные значения + «Все») |
| 14 | Двойной клик по числовой ячейке (Кол-во) с нечислом | Валидация на сохранении, `toast.error`, откат (как текущий `VacancyEditableCell`) |
| 15 | Inline-смена статуса на `closed` | Открывается выбор даты → PATCH со `status=closed, closed_at` → TTF пересчитывается БД |
| 16 | `executive` открывает таблицу | Колонка «Менеджер» скрыта/без имени (EC-09); новые поля видны; правка недоступна |
| 17 | `comment`/`explanation` > лимита | Zod 422 + CHECK на БД; `toast.error` |
| 18 | Горизонтальный скролл (16 колонок) | Контейнер `overflow-x-auto`; шапка не ломается; sticky первая колонка (Название) опционально |
| 19 | Пустой список после фильтра | «Вакансий нет.» (empty state), не ошибка |
| 20 | manager создаёт заявку с `appearance_reason/explanation` | Разрешено; поля сохраняются; `department` не пишется |

---

## 7. Файлы

### Новые
- `supabase/migrations/<ts>_vacancies_data_fields.sql` — §2 (enum + 4 колонки + CHECK + COMMENT депрекации).

### Изменяемые
- `src/types/database.ts`, `src/types/index.ts` — `appearance_reason` (enum-тип), `explanation`, `candidate_name`, `comment`; пометка `department` как legacy в комментарии.
- `src/lib/validations.ts` — `appearanceReasonSchema`; +4 поля в `vacancyCreateSchema`/`vacancyUpdateSchema`/`vacancyRequestCreateSchema`; `subdivision` в `vacancyAdminQuerySchema`.
- `src/app/api/vacancies/route.ts` — POST: +4 поля, **убрать запись `department`**.
- `src/app/api/vacancies/admin/route.ts` — select +4 поля; фильтр `subdivision` (`eq`).
- `src/app/api/vacancies/requests/route.ts` — приём `appearance_reason/explanation`; **убрать `department`**.
- `src/app/api/vacancies/requests/[id]/activate/route.ts` — сиблинги: **убрать наследование `department`** (оставить `subdivision`).
- `src/components/vacancies/AdminVacanciesClient.tsx` — переверстка: 16 колонок, `STATUS_ROW_VARIANTS` на `TableRow`, `PRIORITY_VARIANTS`, `APPEARANCE_REASON_LABELS`, TTF-правило, компактность, поле/фильтр подразделения, новые inline-ячейки.
- `src/components/vacancies/VacancyForm.tsx` — **фикс бага**: `department` → `subdivision`.
- `src/app/(app)/vacancies/[id]/edit/page.tsx` — `initial` читает `subdivision`.
- `src/tests/components/AdminVacanciesClient.test.tsx` — обновить под новые колонки/цвета/фильтр.

### НЕ трогать
- `days_to_close` (GENERATED) — оставить как есть.
- `department` колонку — **не дропать** (legacy; дроп — поздняя отдельная миграция).
- `request_reason` и контур заявок (`VacancyRequestForm`/`VacancyRequestList`) — не смешивать с `explanation`.
- Спеки #1/#2 (эстафета, привязка к штатке, `compute_staffing_plan`, `occupied_units`) — без изменений.
- RLS-политики `vacancies` — без изменений.
- M2M-менеджеры — вне scope (#4).

---

**Развилки закрыты:** A → отдельное `explanation`; B → один `manager_id` (M2M в #4). **Без TODO/«или».**
