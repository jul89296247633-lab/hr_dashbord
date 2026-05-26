# Feature: Онбординг компании через шаблоны (Template Upload)

> **Проект:** Yamaguchi Sales Intelligence Platform
> **Дата:** 2026-05-26
> **Приоритет:** Critical
> **Оценка:** 1.5 дня

---

## 1. User Story

**Как** HR-администратор новой компании,
**я хочу** скачать готовые XLSX-шаблоны (Data, Бонусы_HR, Список HR), заполнить их и загрузить обратно,
**чтобы** запустить систему с нуля без ручного ввода в БД, а дальше работать через интерфейс и API.

### Сценарий использования
1. HR открывает раздел «Запуск компании» (мастер онбординга)
2. Скачивает три XLSX-шаблона — заголовки и порядок колонок как в привычных Google Sheets листах
3. Заполняет шаблоны данными (вакансии, тарифы бонусов, список HR-менеджеров)
4. Загружает файл (один XLSX с тремя листами, либо по одному)
5. Система парсит, валидирует, показывает **превью с diff**: «Будет добавлено 199, обновлено 0, ошибок 2»
6. HR видит подсвеченные битые строки (омоглифы, неверные даты, дубли HH ID)
7. HR грузит валидные строки или скачивает отчёт об ошибках, чинит, повторяет
8. После подтверждения данные пишутся в БД, лог попадает в `sync_logs` (source='sheets')
9. С этого момента система работает через свой API, Google Sheets больше не нужен

### Критерии приёмки
- [ ] Скачивание пустого шаблона генерируется на лету из схемы БД
- [ ] Заголовки и порядок колонок совпадают с текущими Google Sheets листами
- [ ] Парсинг XLSX с несколькими листами в одном файле
- [ ] Превью diff до записи в БД (insert/update/skip/error по строкам)
- [ ] Битые строки подсвечены с причиной, не блокируют валидные
- [ ] Детект латинских омоглифов в названиях/именах с предупреждением
- [ ] Дубли hh_vacancy_id обнаруживаются и помечаются
- [ ] Запись в БД транзакционна на уровне подтверждённого набора
- [ ] Каждая загрузка логируется в sync_logs

---

## 2. Изменения в базе данных

> Целевые таблицы уже существуют. Добавляем только таблицу учёта загрузок (опционально, для истории и idempotency).

### Новые таблицы
```sql
-- История загрузок шаблонов (аудит + защита от повторной заливки того же файла)
CREATE TABLE template_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES user_profiles(id),
  template_type TEXT NOT NULL CHECK (template_type IN ('data', 'bonus_rates', 'hr_list', 'staffing_plan', 'combined')),
  file_name TEXT NOT NULL,
  file_hash TEXT,                          -- sha256 для детекта повторной загрузки
  rows_total INTEGER DEFAULT 0,
  rows_inserted INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  rows_error INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'previewed', 'applied', 'failed')),
  error_report JSONB,                      -- массив {row, column, reason}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_uploads_uploaded_by ON template_uploads(uploaded_by);
CREATE INDEX idx_template_uploads_status ON template_uploads(status);

ALTER TABLE template_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_uploads_select"
  ON template_uploads FOR SELECT
  USING (
    uploaded_by = auth.uid()
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('executive','head','admin')
  );
```

### Изменения в существующих таблицах
> Изменения в целевых таблицах не требуются — vacancies, bonus_rates, hr_manager_syncs, user_profiles уже готовы.

---

## 3. Изменения в API

#### `GET /api/templates/[type]/download`
**Описание:** Скачать пустой XLSX-шаблон | **Авторизация:** Требуется
**Параметры:** `type` ∈ `data` | `bonus_rates` | `hr_list` | `combined`
**Ответ 200:** бинарный XLSX (Content-Type: application/vnd.openxmlformats...)
**Логика:** генерирует лист с заголовками из маппинга схема↔Sheets (см. раздел 5)

#### `POST /api/templates/upload`
**Описание:** Загрузить заполненный шаблон, получить превью | **Авторизация:** HR (head/admin предпочтительно)
**Запрос:** `multipart/form-data` с файлом XLSX
**Ответ 200:**
```json
{
  "data": {
    "upload_id": "uuid",
    "preview": {
      "data": { "insert": 199, "update": 0, "skip": 0, "error": 2 },
      "bonus_rates": { "insert": 66, "update": 0, "skip": 0, "error": 0 },
      "hr_list": { "insert": 26, "update": 0, "skip": 0, "error": 0 }
    },
    "errors": [
      { "sheet": "Data", "row": 8, "column": "Название вакансии", "reason": "Латинский омоглиф 'C' в позиции 1" },
      { "sheet": "Data", "row": 42, "column": "ID HH", "reason": "Дубликат hh_vacancy_id 131739178" }
    ]
  }
}
```

#### `POST /api/templates/upload/[upload_id]/apply`
**Описание:** Применить превью к БД (после подтверждения HR) | **Авторизация:** HR
**Запрос:** `{ "skip_errors": true }`
**Ответ 200:** `{ "data": { "applied": true, "inserted": 289, "updated": 0, "sync_log_id": "uuid" } }`
**Ответ ошибки:** `{ "error": { "code": "UPLOAD_EXPIRED", "message": "Превью устарело, загрузите файл заново" } }`

#### `GET /api/templates/upload/[upload_id]/error-report`
**Описание:** Скачать отчёт об ошибках в XLSX | **Авторизация:** HR
**Ответ 200:** бинарный XLSX с битыми строками и причинами

### Изменения в существующих эндпоинтах
- Sheets-sync (`/api/sync/sheets`): после онбординга через шаблоны — **отключить cron** (БД становится мастером). Эндпоинт оставить для обратной совместимости, но не вызывать автоматически.

---

## 4. Изменения в UI

### Новые экраны/компоненты
| Компонент | Путь/Расположение | Что показывает |
|-----------|-------------------|----------------|
| `OnboardingWizard` | Раздел «Запуск компании» | Мастер: скачать → заполнить → загрузить → подтвердить |
| `TemplateDownloadCard` | Шаг 1 мастера | Три кнопки скачивания шаблонов + инструкция |
| `TemplateUploadZone` | Шаг 2 мастера | Drag-n-drop загрузки XLSX |
| `DiffPreviewTable` | Шаг 3 мастера | Таблица превью: insert/update/skip/error по строкам |
| `ErrorRowList` | Внутри превью | Список битых строк с причинами и подсветкой |

### Изменения в существующих экранах
| Экран | Что меняется |
|-------|-------------|
| Дашборд (sidebar) | Пункт «Запуск компании» (видим только при пустой БД или для admin) |
| Настройки | Кнопка «Загрузить данные из шаблона» для дозагрузки |

### Состояния
- **Loading:** прогресс-бар парсинга («Обработано 150 из 199 строк»)
- **Empty:** «Загрузите заполненный шаблон, чтобы начать»
- **Error:** красная панель «Файл не распознан как XLSX» / «Лист 'Data' не найден»

---

## 5. Business Logic

### Маппинг шаблонов (схема БД ↔ Google Sheets колонки)

**Шаблон Data → таблица `vacancies`**
| Колонка в шаблоне (как в Sheets) | Поле БД | Обязательно |
|---|---|---|
| Название вакансии | title | да |
| ID HH | hh_vacancy_id | нет (пусто у конфиденциальных) |
| Город | location | нет |
| Дата открытия | opened_at | да |
| Дата закрытия | closed_at | нет |
| Статус | status (Закрыта→closed, иначе active) | да |
| Конфиденциальность | confidentiality (Да→confidential, иначе open) | нет |
| Менеджеры | → matched manager_id через user_profiles | нет |
| Подразделение | subdivision | нет |
| Приоритет | priority (высокий/средний/низкий) | нет |

> **Конфиденциальные при загрузке:** если `confidentiality='confidential'` и ID HH пуст — генерируется `internal_ref` (CONF-ГГГГ-NNNN), пустой HH ID НЕ считается ошибкой. У открытых пустой HH ID → warning.

**Шаблон Бонусы_HR → таблица `bonus_rates`**
| Колонка | Поле БД | Обязательно |
|---|---|---|
| Должность | position_name | да |
| Сумма бонуса (руб) | amount_kopecks (×100) | да |
| Группа | group_name | нет |

**Шаблон Список HR → таблицы `user_profiles` + `hr_manager_syncs`**
| Колонка | Поле БД | Обязательно |
|---|---|---|
| ФИО | full_name / sheet_full_name | да |
| Email | email | да |
| Роль | role (manager/head/executive/admin) | да |
| HH Manager ID | hh_manager_id | нет |

**Шаблон Штатное расписание → таблица `staffing_plan`**
| Колонка | Поле БД | Обязательно |
|---|---|---|
| Город | city | да |
| Должность | position_name (единая номенклатура с bonus_rates) | да |
| Кол-во единиц | planned_units | да |

> **Важно:** `staffing_plan.city` сопоставляется с `vacancies.location` при расчёте заполненности. Значения городов должны совпадать по написанию (нормализовать при загрузке). Должность сопоставляется с `bonus_rates.position_name` — единая номенклатура.

### Правила
- **Деньги:** суммы в шаблоне в рублях → хранятся в копейках (×100), как везде в системе.
- **Матчинг ключей:** Data — каскад: есть hh_vacancy_id → матч по нему; иначе есть internal_ref → матч по нему (конфиденциальные); иначе INSERT. bonus_rates по `position_name` (unique); HR по `email` (unique); staffing_plan по `(city, position_name)`.
- **Омоглифы:** при детекте латинских символов в кириллическом контексте — строка помечается warning, но не блокируется (HR решает).
- **Транзакционность:** apply пишет всё в одной транзакции на тип шаблона; при сбое — rollback, статус `failed`.
- **Idempotency:** file_hash сверяется — повторная загрузка того же файла даёт предупреждение.

### Интеграции
- **Сервис:** Supabase Storage (опционально) — хранение загруженных файлов для аудита
- **При ошибке:** загрузка не блокируется, файл просто не архивируется

---

## 6. Edge Cases

| # | Ситуация | Поведение системы |
|---|----------|-------------------|
| 1 | Латинский омоглиф в названии/имени | Warning в превью, строка грузится по решению HR |
| 2 | Дубликат hh_vacancy_id внутри файла | Error, строка помечена, не грузится |
| 3 | hh_vacancy_id уже есть в БД | Update вместо insert, показано в diff |
| 4 | Неверный формат даты (не ДД.ММ.ГГГГ) | Error на строке с указанием колонки |
| 5 | Менеджер из колонки не найден в user_profiles | Warning, manager_id=NULL, вакансия грузится |
| 6 | Лист в XLSX назван не как ожидается | Error «Лист 'Data' не найден», предложить переименовать |
| 7 | Сумма бонуса с пробелами/₽ («5 000 ₽») | Парсер чистит, конвертит в копейки |
| 8 | Пустой шаблон (только заголовки) | Превью 0 строк, apply ничего не делает |
| 9 | Email невалидный по regex БД | Error на строке HR-листа |
| 10 | Повторная загрузка идентичного файла (тот же hash) | Warning «Этот файл уже загружен ДД.ММ» |
| 11 | apply вызван по устаревшему upload_id | 409 UPLOAD_EXPIRED, заново загрузить |
| 12 | Конфиденциальная вакансия с пустым HH ID | Норма: генерится internal_ref, не ошибка |
| 13 | Открытая вакансия с пустым HH ID | Warning, грузится по решению HR |
| 14 | Должность в staffing_plan не совпадает с bonus_rates | Warning о расхождении номенклатуры |

---

## 7. Файлы, которые будут затронуты

> Этот раздел помогает Claude Code понять scope изменений и ничего не забыть.

### Новые файлы
- `app/(app)/onboarding/page.tsx` — страница мастера запуска
- `components/onboarding/OnboardingWizard.tsx` — оркестратор шагов
- `components/onboarding/TemplateDownloadCard.tsx` — скачивание шаблонов
- `components/onboarding/TemplateUploadZone.tsx` — загрузка файла
- `components/onboarding/DiffPreviewTable.tsx` — превью diff
- `components/onboarding/ErrorRowList.tsx` — список ошибок
- `app/api/templates/[type]/download/route.ts` — генерация пустого шаблона
- `app/api/templates/upload/route.ts` — парсинг + превью
- `app/api/templates/upload/[upload_id]/apply/route.ts` — запись в БД
- `app/api/templates/upload/[upload_id]/error-report/route.ts` — отчёт об ошибках
- `lib/templates/schema-mapping.ts` — маппинг схема↔Sheets колонки (единый источник)
- `lib/templates/xlsx-parser.ts` — парсинг XLSX (SheetJS)
- `lib/templates/homoglyph-detector.ts` — детект латинских омоглифов
- `lib/validations/template-row.ts` — Zod-схемы строк по типам
- `supabase/migrations/20260526_template_uploads.sql` — таблица template_uploads + RLS

### Изменяемые файлы
- `types/index.ts` — типы template_uploads
- `components/layout/Sidebar.tsx` — пункт «Запуск компании»
- `lib/queries/sync.ts` — отключить автокрон sheets-sync после онбординга

### НЕ трогать (защита от регрессий)
- `app/api/sync/sheets/route.ts` — логика остаётся, но не вызывается из cron
- Существующие таблицы vacancies/bonus_rates/hr_manager_syncs/user_profiles — только запись через маппинг, без изменения структуры
- Логика KPI, бонусов, hh_manager_stats
