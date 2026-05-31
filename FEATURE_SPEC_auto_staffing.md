# Feature: Авто-укомплектованность на точной привязке вакансия↔штатка

> **Проект:** HR Control Tower · **Дата:** 2026-05-31 · **Приоритет:** High · **Оценка:** 1–1.5 дня
> **Зависимости:** штатка (`staffing_plan`, XLSX-импорт) — есть; статусы вакансий probation/cancelled (спека #1) — применены.
> **Вне scope:** деление розница/компания, channel, in_progress — НЕ делаем (укомплектованность общая).

## 1. User Story

**Как** руководитель HR, **я хочу** чтобы укомплектованность считалась автоматически из статусов вакансий, привязанных к строкам штатного расписания, **чтобы** не вести «Занято» вручную и видеть реальную картину.

### Сценарий
1. При создании заявки на вакансию выбирается **Город**, затем **Должность из выпадающего списка штатки этого города** → вакансия привязывается к строке штатки (`staffing_plan_id`); `title`/`location` автозаполняются.
2. Если позиции нет в штатке — опция «нет в штатке»: свободный ввод названия, без привязки (в укомплектованность не попадёт).
3. Укомплектованность строки штатки = `(план − привязанные не-closed вакансии) / план` (занято = только закрытые наймом).
4. Закрытие (closed) привязанной вакансии → дыра исчезает → занято растёт автоматически.
5. Старые вакансии без привязки: 6 точных совпадений привязаны миграцией; остальные admin привязывает вручную в `/vacancies/admin` по необходимости.

### Критерии приёмки
- [ ] `vacancies.staffing_plan_id` (FK → staffing_plan, ON DELETE SET NULL) добавлен; backfill точных (city+position) выполнен.
- [ ] `compute_staffing_plan` считает `occupied = GREATEST(planned − holes, 0)`, `holes = COUNT(привязанные вакансии status NOT IN ('closed','draft'))` (занято = только closed), `vacant = holes`; матчинг по `staffing_plan_id`, не fuzzy; `in_progress` отсутствует.
- [ ] Форма заявки: выбор должности из штатки города → `staffing_plan_id`; опция «нет в штатке» (свободный ввод, NULL).
- [ ] `/vacancies/admin`: ручная привязка вакансии к строке штатки (селект).
- [ ] Импорт XLSX-штатки «Занято» игнорируется (`occupied_units` не пишется); форма штатки поле «Занято» убрано; колонка `occupied_units` в БД НЕ удалена (legacy).
- [ ] StaffingCheckWidget / StaffingPlanTable / типы — без `in_progress`; `tsc`/`lint` 0.

## 2. Изменения в базе данных

```sql
-- ── 2.1 vacancies: явная привязка к строке штатки ───────────────────────────
ALTER TABLE public.vacancies
  ADD COLUMN staffing_plan_id UUID REFERENCES public.staffing_plan(id) ON DELETE SET NULL;
CREATE INDEX idx_vacancies_staffing_plan
  ON public.vacancies (staffing_plan_id) WHERE staffing_plan_id IS NOT NULL;

-- Backfill: точные совпадения (город + должность), только непривязанные.
UPDATE public.vacancies v
SET staffing_plan_id = sp.id
FROM public.staffing_plan sp
WHERE v.staffing_plan_id IS NULL
  AND v.location = sp.city
  AND v.title = sp.position_name;

-- ── 2.2 Новый compute_staffing_plan: occupied из статусов, без in_progress ───
-- DROP+CREATE т.к. меняется RETURNS TABLE (убираем in_progress). Сигнатуру
-- (text, double precision) СОХРАНЯЕМ — call-sites не меняются; p_threshold игнор.
DROP FUNCTION IF EXISTS public.compute_staffing_plan(text, double precision);
CREATE FUNCTION public.compute_staffing_plan(
  p_city text DEFAULT NULL,
  p_threshold double precision DEFAULT 0.4   -- не используется (оставлен для совместимости вызовов)
)
RETURNS TABLE (
  id uuid, city text, position_name text, planned_units integer,
  comment text, created_at timestamptz, updated_at timestamptz,
  occupied integer, vacant integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id, sp.city, sp.position_name, sp.planned_units, sp.comment, sp.created_at, sp.updated_at,
    GREATEST(sp.planned_units - COALESCE(h.holes, 0), 0)::INTEGER AS occupied,
    COALESCE(h.holes, 0)::INTEGER                                 AS vacant
  FROM public.staffing_plan sp
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS holes
    FROM public.vacancies v
    WHERE v.staffing_plan_id = sp.id
      -- ДЫРА (место пустое) = любой активированный статус, КРОМЕ closed:
      -- active/probation/paused/cancelled. Занято ТОЛЬКО closed (реальный найм).
      -- draft (заявка до активации, в т.ч. отклонённая) НЕ считается дырой.
      AND v.status NOT IN ('closed', 'draft')
  ) h ON TRUE
  WHERE p_city IS NULL OR sp.city = p_city
  ORDER BY sp.city, sp.position_name;
$$;

-- Восстановить гранты SEC-001 (DROP сбросил ACL): не для anon, только authenticated/service_role.
REVOKE EXECUTE ON FUNCTION public.compute_staffing_plan(text, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_staffing_plan(text, double precision) TO authenticated;

-- occupied_units НЕ дропаем (legacy, недеструктивно). RPC её больше не читает.
```

> RLS не меняется (новых таблиц нет; vacancies/staffing_plan под RLS). FK ON DELETE SET NULL: удаление строки штатки отвязывает вакансии (не каскадит удаление вакансий).

## 3. Изменения в API

#### `GET /api/staffing/positions?city=<city>` (новый)
**Описание:** позиции штатки выбранного города для дропдауна формы. **Авторизация:** authenticated (заявку создаёт любой).
**Ответ 200:** `{ "data": { "positions": [ { "id": "<uuid>", "position_name": "Продавец" } ] } }`
**Источник:** `SELECT id, position_name FROM staffing_plan WHERE city = $1 ORDER BY position_name`.

#### `POST /api/vacancies/requests` (расширение)
В `vacancyRequestCreateSchema`: `staffing_plan_id: z.string().uuid().nullable().optional()`.
Логика: если `staffing_plan_id` задан → сервер читает строку штатки и **авторитетно** ставит `title = position_name`, `location = city` (целостность привязки); иначе (NULL) — свободные `title`/`location`.
**Запрос:** `{ "staffing_plan_id":"<uuid>", "manager_id":"<uuid>", "confidentiality":"open", "positions_count":1 }` или `{ "title":"Нестандартная роль", "location":"Сочи", "staffing_plan_id":null, ... }`

#### `PATCH /api/vacancies/requests/[id]/activate` (расширение)
Сиблинги мульти-позиции (спека #1) **наследуют `staffing_plan_id`** исходной строки (вставка siblings: `staffing_plan_id: vacancy.staffing_plan_id`).

#### `PATCH /api/vacancies/[id]` (расширение — ручная привязка)
В `vacancyUpdateSchema`: `staffing_plan_id: z.string().uuid().nullable().optional()` (привязка/отвязка). NULL — отвязать.
**Запрос:** `{ "staffing_plan_id": "<uuid>" }` | `{ "staffing_plan_id": null }`

#### `GET /api/staffing/plan` и `GET /api/staffing/availability` (изменение формы ответа)
RpcRow и ответ — **без `in_progress`** (occupied/vacant из нового RPC). Вызовы RPC не меняются (сигнатура та же).

#### `POST /api/staffing/plan` (депрекация occupied)
`staffingPlanUpsertSchema`: `occupied_units` убрать (или принять и игнорировать — НЕ писать в БД). Upsert пишет только `planned_units`/`comment`.

## 4. Изменения в UI

| Компонент | Путь | Что |
|---|---|---|
| VacancyRequestForm | `src/components/vacancy-requests/VacancyRequestForm.tsx` | город → дропдаун должностей штатки (`/api/staffing/positions?city`) → `staffing_plan_id`; авто title/location; чекбокс «нет в штатке» (свободный ввод, NULL); смена города сбрасывает выбранную позицию |
| AdminVacanciesClient | `src/components/vacancies/AdminVacanciesClient.tsx` | действие «Привязать к штатке» (селект строки штатки) → PATCH `staffing_plan_id`; колонка-индикатор привязки |
| StaffingCheckWidget | `src/components/staffing/StaffingCheckWidget.tsx` | убрать колонку «В работе» (in_progress); «Занято»=occupied, «Вакантно»=vacant |
| StaffingPlanTable | `src/components/staffing/StaffingPlanTable.tsx` | убрать колонку in_progress |
| StaffingPlanRowForm | `src/components/staffing/StaffingPlanRowForm.tsx` | убрать поле «Занято» (occupied вычисляется) |

### Состояния
- **Loading:** Skeleton. **Empty:** «Штат по городу не задан» / «Должностей нет». **Error:** toast/Alert по `error.message`.

## 5. Business Logic

### Привязка
- Источник истины связи — `vacancies.staffing_plan_id` (FK). Никакого fuzzy.
- Форма: выбор позиции из штатки города → id. «Нет в штатке» → NULL (вакансия вне учёта укомплектованности).
- При `staffing_plan_id` задан — сервер ставит `title`/`location` из строки штатки (консистентность).

### Укомплектованность (новый RPC)
- **Занято = ТОЛЬКО `closed`** (реальный найм). Любой другой активированный статус (active/probation/paused/cancelled) = **дыра** (место пустое).
- `holes = COUNT(привязанные вакансии WHERE status NOT IN ('closed','draft'))`; `occupied = GREATEST(planned_units − holes, 0)`; `vacant = holes`; `% = occupied/planned_units` (planned=0 → «—», см. EC-04).
- `draft` исключён: заявка до активации (в т.ч. отклонённая) — не пустое место.
- **Пример:** план=1, открыли вакансию → holes=1 → occupied=0; отменили (cancelled) → holes=1 (cancelled = дыра) → occupied=0 (место пустое, укомплектованность НЕ завышается). Только переход в closed → holes=0 → occupied=1.

### Депрекация occupied_units
- RPC не читает `occupied_units`. Импорт XLSX и форма штатки не пишут его. Колонка остаётся (legacy, 317 значений — мёртвые). НЕ дропаем.

### Миграция старых вакансий
- Backfill: 6 точных (city+position). Остальные ~158 — `staffing_plan_id=NULL`, ручная привязка в `/vacancies/admin` по необходимости. Fuzzy НЕ применяем.

## 6. Edge Cases

| # | Ситуация | Поведение |
|---|----------|-----------|
| 1 | Вакансия `staffing_plan_id IS NULL` (свободная) | НЕ попадает в holes ни одной строки штатки → в укомплектованности не учитывается |
| 2 | Удалена строка штатки | FK ON DELETE SET NULL → привязанные вакансии `staffing_plan_id=NULL` (вакансии не удаляются), перестают считаться |
| 3 | Привязанная вакансия в группе позиций (эстафета, спека #1) | сиблинги наследуют `staffing_plan_id`; каждый не-closed сиблинг = дыра; закрытие (closed) по эстафете уменьшает holes → occupied растёт |
| 4 | `planned_units = 0` | occupied=GREATEST(0−holes,0)=0; vacant=holes; `%` не считается (UI показывает «—») |
| 5 | holes > planned (открытых больше плана) | occupied=0 (GREATEST); vacant=holes (реальное число дыр, может быть > план) |
| 6 | Смена статуса привязанной active→closed | holes−1 → occupied+1 (единственный путь «занять» место; RPC stable, пересчёт на лету) |
| 7 | active→probation | остаётся дырой (не closed) → occupied не меняется |
| 8 | probation→active | остаётся дырой → occupied не меняется |
| 9 | active→cancelled | **остаётся дырой** (cancelled ≠ closed) → occupied НЕ меняется (место пустое, укомплектованность не завышается) |
| 10 | active→paused | **остаётся дырой** (paused ≠ closed) → occupied НЕ меняется |
| 10b | План=1: открыли→отменили (cancelled) | holes=1 → occupied=0 (пустое), НЕ 1. Только closed дал бы occupied=1 |
| 10c | Привязанный `draft` (заявка/отклонённая, до активации) | НЕ дыра (исключён из COUNT) → не засчитывается; иначе rejected-заявки были бы вечными дырами |
| 11 | Backfill: вакансия уже привязана вручную | `WHERE staffing_plan_id IS NULL` — не перезатираем существующую привязку |
| 12 | Две строки штатки одинаковой должности в разных городах | форма фильтрует по городу → выбирается верный id; привязка по id однозначна |
| 13 | Свободная вакансия в городе со штаткой | без привязки → не учитывается (fuzzy не подхватывает; осознанно) |
| 14 | Импорт XLSX «Занято»=N | игнорируется (occupied_units не пишется); RPC всё равно не читает |
| 15 | Форма: смена города после выбора позиции | выбранная позиция/`staffing_plan_id` сбрасывается (позиции другого города) |
| 16 | manager создаёт заявку с `staffing_plan_id` | разрешено (привязка от роли не зависит); title/location сервер берёт из штатки |
| 17 | RPC `p_city=NULL` | все города; `p_city=X` — один (как раньше) |
| 18 | После DROP+CREATE RPC | REVOKE anon восстановлен (нет регресса SEC-001); advisor без новых WARN |
| 19 | occupied никогда не отрицательный | GREATEST(...,0) |
| 20 | Привязка указывает на строку, потом город вакансии вручную изменили | учёт по `staffing_plan_id` (не по location) → консистентно; location — только отображение |

## 7. Файлы, которые будут затронуты

### Новые
- `supabase/migrations/<ts>_auto_staffing.sql` — §2 (FK+index+backfill, DROP+CREATE RPC, гранты).
- `src/app/api/staffing/positions/route.ts` — позиции штатки по городу.

### Изменяемые
- `src/lib/validations.ts` — `vacancyRequestCreateSchema`/`vacancyUpdateSchema` (+`staffing_plan_id`); `staffingPlanUpsertSchema` (убрать `occupied_units`).
- `src/app/api/vacancies/requests/route.ts` — приём `staffing_plan_id`, авто title/location из штатки.
- `src/app/api/vacancies/requests/[id]/activate/route.ts` — сиблинги наследуют `staffing_plan_id`.
- `src/app/api/vacancies/[id]/route.ts` — приём `staffing_plan_id` (ручная привязка/отвязка).
- `src/app/api/staffing/plan/route.ts`, `src/app/api/staffing/availability/route.ts` — RpcRow/ответ без `in_progress`; POST не пишет `occupied_units`.
- `src/lib/templates/diff-builder.ts` + `src/app/api/templates/upload/[upload_id]/apply/route.ts` — перестать писать `occupied_units` в staffing-апдейты («Занято» парсится, но в БД не пишется).
- `src/components/vacancy-requests/VacancyRequestForm.tsx` — выбор должности из штатки + «нет в штатке».
- `src/components/vacancies/AdminVacanciesClient.tsx` — ручная привязка.
- `src/components/staffing/StaffingCheckWidget.tsx`, `StaffingPlanTable.tsx`, `StaffingPlanRowForm.tsx` — убрать in_progress / поле «Занято».
- `src/types/index.ts`, `src/types/database.ts` — `vacancies.staffing_plan_id`; `compute_staffing_plan` Returns без in_progress; StaffingPlanRow/StaffingAvailabilityResponse без in_progress.

### НЕ трогать
- `occupied_units` колонка БД — НЕ дропать (legacy).
- «Занято» в XLSX-шаблоне/парсере — ОСТАЁТСЯ как колонка, просто не пишется в БД (правка только в diff-builder/apply — см. «Изменяемые»).
- sheets-sync, hh-csv, hired-employees-триггеры (спека #1), мульти-HH — без изменений.

## 8. Verification (после реализации)

1. Миграция: `supabase migration new` → показать → `db push`; `get_advisors(security)` — RPC без anon-EXECUTE (SEC-001 не регрессировал), без новых WARN.
2. Backfill: 6 активных привязаны (`staffing_plan_id` заполнен).
3. Укомплектованность: привязать active-вакансию (план=1) → occupied=0/vacant=1; cancelled/paused → остаётся occupied=0 (дыра); closed → occupied=1; planned=0 → «—»; holes>plan → occupied=0.
4. Форма: город → дропдаун должностей штатки → выбор → staffing_plan_id + автозаполнение; «нет в штатке» → NULL.
5. Ручная привязка в /vacancies/admin → PATCH staffing_plan_id.
6. tsc/lint 0; StaffingCheckWidget/StaffingPlanTable без in_progress не падают.
