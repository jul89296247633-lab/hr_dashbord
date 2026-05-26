# Feature: Штатное расписание (Staffing Plan)

> **Проект:** HR Control Tower
> **Дата:** 2026-05-26
> **Приоритет:** High
> **Оценка:** 1 день

> ⚠️ НЕ путать с существующим `/staffing` («Укомплектованность» — ручной общий % в `staffing_records`).
> Это отдельная сущность: план штата по городам и должностям + расчёт заполненности.

---

## 1. User Story

**Как** руководитель HR,
**я хочу** вести штатное расписание (сколько единиц каждой должности положено по городам) и видеть фактическую заполненность,
**чтобы** обосновывать заявки на вакансии и контролировать переизбыток/недобор по позициям.

### Сценарий использования
1. Head открывает раздел «Штатное расписание» (`/staffing/plan`)
2. Видит таблицу: город → должность → план / занято / в работе / вакантно
3. Может добавить/изменить плановую единицу (город + должность + количество)
4. При создании заявки на вакансию (другая фича) виджет берёт данные отсюда через `GET /api/staffing/availability`
5. Если по городу+должности `вакантно ≤ 0` — система предупреждает о превышении плана

### Критерии приёмки
- [ ] Head/admin могут создавать и редактировать плановые единицы
- [ ] Executive видит штат read-only (как и `/staffing`)
- [ ] Заполненность считается на лету: план − занято − в работе = вакантно
- [ ] «Занято» = активные сотрудники (hired_employees) по городу+должности
- [ ] «В работе» = активные вакансии (status='active') по location+должности
- [ ] Города матчатся с `vacancies.location` (одинаковое написание)
- [ ] Должности матчатся с `bonus_rates.position_name` (единая номенклатура)
- [ ] Уникальность плана по `(city, position_name)`

---

## 2. Изменения в базе данных

### Новые таблицы
```sql
-- Штатное расписание: план единиц по городам и должностям
CREATE TABLE public.staffing_plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL CHECK (char_length(city) >= 2 AND char_length(city) <= 100),
  position_name TEXT NOT NULL CHECK (char_length(position_name) >= 2 AND char_length(position_name) <= 200),
  planned_units INTEGER NOT NULL CHECK (planned_units >= 0 AND planned_units <= 999),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_by UUID REFERENCES public.user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city, position_name)
);

CREATE INDEX idx_staffing_plan_city ON public.staffing_plan(city);
CREATE INDEX idx_staffing_plan_position ON public.staffing_plan(position_name);

ALTER TABLE public.staffing_plan ENABLE ROW LEVEL SECURITY;

-- Все авторизованные видят (как staffing_records — мотивационный/плановый элемент)
CREATE POLICY "staffing_plan_select_all" ON public.staffing_plan
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Создавать/менять может только head/admin
CREATE POLICY "staffing_plan_write_head" ON public.staffing_plan
  FOR ALL USING (
    (SELECT role FROM public.user_profiles WHERE id = auth.uid()) IN ('head', 'admin')
  );

-- Аудит через триггер — использовать ТУ ЖЕ функцию, что у audit_staffing_records
-- (Claude Code: найди существующую audit-функцию в миграциях, не создавай новую)
CREATE TRIGGER audit_staffing_plan
  AFTER INSERT OR UPDATE OR DELETE ON public.staffing_plan
  FOR EACH ROW EXECUTE FUNCTION <существующая_audit_функция>();
```

> Изменения в существующих таблицах не требуются. Заполненность вычисляется из vacancies/hired_employees на лету.

---

## 3. Изменения в API

#### `GET /api/staffing/plan`
**Описание:** Список плановых единиц с заполненностью | **Авторизация:** Требуется
**Файл:** `app/api/staffing/plan/route.ts`
**Ответ 200:**
```json
{
  "data": [
    { "id": "uuid", "city": "Сочи", "position_name": "Продавец-консультант",
      "planned": 8, "occupied": 5, "in_progress": 1, "vacant": 2 }
  ]
}
```

#### `POST /api/staffing/plan`
**Описание:** Создать/обновить плановую единицу | **Авторизация:** head/admin
**Файл:** `app/api/staffing/plan/route.ts` (метод POST)
**Запрос:** `{ "city": "Сочи", "position_name": "Продавец-консультант", "planned_units": 8, "comment": "Открытие ТЦ Моремолл" }`
**Ответ 200:** `{ "data": { "id": "uuid", "city": "Сочи", "planned_units": 8 } }`
**Ответ ошибки:** `{ "error": { "code": "FORBIDDEN", "message": "Только руководитель может менять штат" } }`

#### `DELETE /api/staffing/plan/[id]`
**Описание:** Удалить плановую единицу | **Авторизация:** head/admin
**Ответ 200:** `{ "data": { "deleted": true } }`

#### `GET /api/staffing/availability?location=Сочи`
**Описание:** Заполненность по городу (для виджета в форме заявки) | **Авторизация:** Требуется
**Файл:** `app/api/staffing/availability/route.ts`
**Логика расчёта:**
```sql
SELECT
  sp.city,
  sp.position_name,
  sp.planned_units AS planned,
  COALESCE(occ.cnt, 0) AS occupied,
  COALESCE(prog.cnt, 0) AS in_progress,
  sp.planned_units - COALESCE(occ.cnt,0) - COALESCE(prog.cnt,0) AS vacant
FROM staffing_plan sp
LEFT JOIN (
  -- занято: активные сотрудники по должности (привязка через vacancy.location)
  SELECT v.location AS city, he.position_name, COUNT(*) cnt
  FROM hired_employees he
  JOIN vacancies v ON v.id = he.vacancy_id
  WHERE he.status IN ('hired','probation')
  GROUP BY v.location, he.position_name
) occ ON occ.city = sp.city AND occ.position_name = sp.position_name
LEFT JOIN (
  -- в работе: активные вакансии по location + должности
  SELECT location AS city, title AS position_name, COUNT(*) cnt
  FROM vacancies
  WHERE status = 'active'
  GROUP BY location, title
) prog ON prog.city = sp.city AND prog.position_name = sp.position_name
WHERE sp.city = $1;
```
**Ответ 200:**
```json
{ "data": { "location": "Сочи", "rows": [
  { "position_name": "Продавец-консультант", "planned": 8, "occupied": 5, "in_progress": 1, "vacant": 2 }
] } }
```
> Если штат по городу не задан — `rows: []`, виджет показывает «Штат по городу не задан».

### Изменения в существующих эндпоинтах
- Изменений нет. `/api/staffing` (укомплектованность) НЕ трогаем.

---

## 4. Изменения в UI

### Новые экраны/компоненты
| Компонент | Путь/Расположение | Что показывает |
|-----------|-------------------|----------------|
| Страница штата | `app/(app)/staffing/plan/page.tsx` | Таблица план/занято/в работе/вакантно |
| `StaffingPlanTable` | Внутри страницы | Группировка по городам, разворачиваемые секции |
| `StaffingPlanRowForm` | Модалка добавления/редактирования | Город + должность + кол-во (head/admin) |
| `StaffingCheckWidget` | Переиспользуется в форме заявки | Компактная таблица заполненности по городу |

### Изменения в существующих экранах
| Экран | Что меняется |
|-------|-------------|
| `components/layout/Sidebar.tsx` | Под пунктом «Укомплектованность» добавить «Штатное расписание» → `/staffing/plan` (head/admin) |

### Состояния
- **Loading:** Skeleton таблицы (по стандарту CLAUDE.md — не spinner)
- **Empty:** «Штатное расписание ещё не задано. Добавьте первую позицию.» + CTA
- **Error:** `toast.error()` через sonner

---

## 5. Business Logic

### Правила
- **Номенклатура должностей единая:** `staffing_plan.position_name` = `bonus_rates.position_name` = `vacancies.title` по смыслу. При вводе должности — автоподсказка из существующих `bonus_rates`.
- **Города из location:** при вводе города — автоподсказка из distinct `vacancies.location`, чтобы написание совпадало.
- **Заполненность не хранится:** всегда вычисляется на лету (план/занято/в работе актуальны на момент запроса).
- **Права:** чтение всем авторизованным; запись только head/admin (как `/staffing`).
- **Деньги** в этой фиче не участвуют.

### Интеграции
- Поставляет данные виджету штатной сверки в форме заявки на вакансию (FEATURE_SPEC_vacancy_request).

---

## 6. Edge Cases

| # | Ситуация | Поведение системы |
|---|----------|-------------------|
| 1 | Manager пытается изменить штат | 403, «Только руководитель может менять штат» |
| 2 | Дубль (city, position_name) | UNIQUE → upsert (обновить planned_units) |
| 3 | Заполнено больше плана (vacant < 0) | Показывается отрицательное/ноль, помечается «превышение» |
| 4 | Город в плане без вакансий | occupied=0, in_progress=0, vacant=planned |
| 5 | Написание города не совпадает с location | Не сматчится → occupied/in_progress = 0; автоподсказка снижает риск |
| 6 | Должность в плане ≠ vacancies.title | Не сматчится по «в работе»; warning о номенклатуре |
| 7 | planned_units = 0 | Допустимо (позиция закрыта по штату), vacant может быть отрицательным |
| 8 | Удаление позиции с активными вакансиями | Разрешено (план и факт независимы), предупреждение |

---

## 7. Файлы, которые будут затронуты

### Новые файлы
- `app/(app)/staffing/plan/page.tsx` — страница штатного расписания
- `components/staffing/StaffingPlanTable.tsx` — таблица с группировкой
- `components/staffing/StaffingPlanRowForm.tsx` — форма позиции
- `components/staffing/StaffingCheckWidget.tsx` — виджет сверки (используется и в заявке)
- `app/api/staffing/plan/route.ts` — GET список + POST upsert
- `app/api/staffing/plan/[id]/route.ts` — DELETE
- `app/api/staffing/availability/route.ts` — расчёт заполненности по городу
- `lib/validations/staffing-plan.ts` — Zod-схемы
- `supabase/migrations/20260526_staffing_plan.sql` — таблица + RLS + аудит-триггер

### Изменяемые файлы
- `types/index.ts` — тип StaffingPlan + ответ availability
- `components/layout/Sidebar.tsx` — пункт «Штатное расписание» для head/admin

### НЕ трогать (защита от регрессий)
- `app/api/staffing/route.ts` + `staffing_records` — «Укомплектованность», отдельная сущность
- `lib/google-sheets.ts`, sheets-sync — не затрагивается
- Логика KPI, бонусов, hh_manager_stats
