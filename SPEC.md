# HR Control Tower — Техническая спецификация

> Версия: 1.0 | Дата: 2026-05-22 | Статус: Production-ready
> Документ написан для AI-агентов (Claude Code). Каждое решение принято. TODO запрещены.

---

## БЛОК 0: Обзор проекта

### Что это

Внутренняя веб-платформа для HR-отдела компании (5–10 менеджеров). Автоматически
собирает данные воронки найма из HH.ru API (включая встроенные звонки HH), принимает ручной ввод
ежедневных активностей от менеджеров, синхронизирует данные о трудоустройстве из Google Sheets файла
и выводит дашборды KPI в разрезе каждого менеджера и вакансии. Платежей нет.
Самостоятельная регистрация отключена — только приглашение от администратора.

### Контекст реального отдела (используется как дефолт во всех примерах)

- Команда: 5 HR-менеджеров + 1 руководитель
- Активных вакансий одновременно: 15–25
- **Планы на менеджера:** 15 звонков/день, 5 собеседований/день, 15 вакансий/месяц (выводов)
- **Источники звонков (два, суммируются):**
  - **Манго ВATС API** — менеджеры звонящие через Манго; cron в 20:00 по `from.extension` (добавочный номер)
  - **HH.ru CSV** — менеджеры звонящие через встроенную функцию HH; загружается вручную через /sync
  - Итого на менеджера: `mango_calls + hh_calls` (у кого нет Манго — только hh; у кого нет HH — только mango)
- **Источники данных из HH.ru:**
  - **API (автоматически, cron 2ч):** отклики, открытые контакты, приглашения по каждой вакансии
  - **CSV-выгрузка из «Аналитика подбора» HH (загружается вручную через /sync):**
    - Раздел «Менеджеры → Звонки» — кол-во звонков по каждому рекрутёру за период
    - Раздел «Менеджеры → Индекс вежливости менеджеров» — отклики, просмотренные, ответы, ИВ по каждому менеджеру
    - Раздел «Компания → Индекс вежливости компании» — сводный ИВ по компании
- **Собеседования:** вводятся вручную в кабинете менеджера каждый день

**Листы Google Sheets (один файл, разные вкладки):**
| Лист | Назначение | Ключевые столбцы |
|------|-----------|-----------------|
| `Вакансии` | Все вакансии, статус и даты | Название, Статус, Подразделение, Менеджер, Дата открытия, Дата закрытия |
| `HR менеджеры` | Список действующих менеджеров | ФИО, Email, Подразделение |
| `Бонусы_HR` | Справочник тарифов «Должность → Стоимость закрытия» (`bonus_rates`) | Должность, Стоимость (руб.) |

- **Воронка подбора (7 этапов):** Отклик → Открытый контакт → Приглашение → Звонок → Собеседование → **Стажировка** → Трудоустройство
- **Просмотры и приглашения HH разделены на платные и бесплатные** (из CSV «Индекс вежливости менеджеров»):
  - `responses_viewed` — бесплатно: «Просмотры (отклики)» (просмотр резюме из входящего отклика).
  - `resume_views_from_search` — ⓟ платно: «Просмотры (поиск) 💰» (менеджер сам нашёл резюме в базе HH).
  - `invitations_from_db` — ⓟ платно: «Приглашения из базы 💰» (приглашение по контакту из базы HH).
  В UI платные метрики помечены 💰 и tooltip-объяснением.
- **Стажировка** — отдельный этап: кандидат принят, но ещё на испытательном сроке/стажировке; фиксируется в Sheets столбцом «Статус» = «стажировка»
- **Срок закрытия:** `closed_at - opened_at` из Sheets (статус «закрыта», дата закрытия заполнена)
- **Цикл найма по подразделениям:** каждая вакансия привязана к подразделению компании

### Стек с версиями

| Слой               | Технология                                              |
|--------------------|---------------------------------------------------------|
| Frontend           | Next.js 15 (App Router), TypeScript 5.4, Tailwind CSS v4, shadcn/ui |
| База данных        | Supabase: PostgreSQL 17, Auth, RLS, Realtime            |
| Деплой фронтенд   | Vercel (автодеплой из ветки main)                       |
| Cron-сервисы       | Beget VPS, Node.js 20, pm2                              |
| Интеграции         | HH.ru API v3 (вакансии, воронка, встроенные звонки), Google Sheets API v4 |
| Уведомления        | Telegram Bot API (только alert-уведомления admin)       |
| Валидация          | Zod 3.x                                                 |
| AI                 | Anthropic Messages API (claude-sonnet-4-5)              |

### Переменные окружения

**Vercel (.env.local):**
```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service...
GOOGLE_SHEETS_SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
GOOGLE_SHEETS_VACANCIES_TAB=Вакансии
HH_CSV_ENCODING=windows-1251
GOOGLE_SHEETS_MANAGERS_TAB=HR менеджеры
GOOGLE_SHEETS_BONUSES_TAB=Бонусы_HR
GOOGLE_SERVICE_ACCOUNT_EMAIL=hr-tower@hr-project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----
TELEGRAM_BOT_TOKEN=7123456789:AAFxyz-telegram-bot-token
TELEGRAM_ADMIN_CHAT_ID=-1001234567890
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Beget VPS (.env для cron-скриптов):**
```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service...
HH_CLIENT_ID=hh-oauth-client-id
HH_CLIENT_SECRET=hh-oauth-client-secret
HH_EMPLOYER_ID=12345678
MANGO_API_KEY=mango-vpbx-api-key-from-lk
MANGO_API_SALT=mango-vpbx-api-salt-from-lk
TELEGRAM_BOT_TOKEN=7123456789:AAFxyz-telegram-bot-token
TELEGRAM_ADMIN_CHAT_ID=-1001234567890
```

### Роли пользователей

| Роль      | Код в БД    | Кто это              | Что видит и делает                                                                    |
|-----------|-------------|----------------------|---------------------------------------------------------------------------------------|
| Менеджер  | `manager`   | HR-рекрутёр          | Свой кабинет ввода активностей, свои вакансии, свои KPI vs план                       |
| Руководитель | `head`   | Начальник HR-отдела  | Все дашборды, планы всех менеджеров, синхронизация Google Sheets/HH, управление укомплектованностью |
| Топ-менеджмент | `executive` | Директор / собственник | Только сводный дашборд + % укомплектованности (read-only, без имён менеджеров) |
| Администратор | `admin`  | IT-специалист        | Всё + управление пользователями, токенами интеграций, логи синхронизаций              |

### URL-маршруты

```
/                        → redirect: /cabinet (manager) или /dashboard (head/executive/admin)
/login                   → страница входа по email + пароль

/cabinet                 → ввод активностей за сегодня (manager)
/cabinet/[date]          → просмотр/редактирование за конкретную дату (format: YYYY-MM-DD)

/dashboard               → сводный дашборд отдела: укомплектованность + KPI + подразделения (head, executive, admin)
/dashboard/efficiency    → эффективность менеджеров: KPI vs план + бонусы (head, admin)
/dashboard/divisions     → аналитика по подразделениям: воронка + сроки + укомплектованность (head, executive, admin)
/dashboard/manager       → личный дашборд текущего менеджера (manager)
/bonuses                 → бонусы HR: рассчитываются на лету из bonus_rates × hired_employees за месяц (head, admin; свои — manager)

/ai                      → AI-инсайты: аномалии + прогнозы + рекомендации + еженедельный отчёт (head, admin)
/ai/report/[week]        → конкретный еженедельный AI-отчёт (head, admin)

/vacancies               → список вакансий (manager видит свои; head/admin/executive — все)
/vacancies/[id]          → воронка по одной вакансии

/plan                    → настройка планов по менеджерам (head, admin)
/staffing                → управление % укомплектованности (head, admin; read-only для остальных)

/sync                    → синхронизации: HH API cron (авто) + Манго cron (авто) + загрузка CSV HH + Google Sheets (head, admin)
/sync/logs               → журнал всех синхронизаций (head, admin)

/admin/users             → управление пользователями (admin)
/admin/integrations      → токены HH OAuth, Google Sheets service account (admin)
/admin/logs              → просмотр audit trail и error logs (admin)
```

---

## БЛОК 1: User Stories

### US-001: Ежедневный ввод активностей HR-менеджером

**Как** HR-менеджер,
**я хочу** за 5–10 минут зафиксировать свои активности за день в одном месте,
**чтобы** руководитель видел мою работу в реальном времени без устных отчётов.

**Сценарий (happy path):**
1. Менеджер открывает `/cabinet` — видит форму на текущую дату
2. Поле «Звонки» уже заполнено значением из HH (cron собрал статистику звонков HH за предыдущий день)
3. Менеджер вводит вручную: собеседований = 4, офферов = 1, заметки = «Два сильных кандидата на Backend Dev»
4. Нажимает «Сохранить» — система делает upsert в `daily_activities`
5. KPI-панель над формой обновляется без перезагрузки: «Звонки 28/30 · Собеседования 4/5 · Офферы 1/4»
6. Toast (sonner, success): «Данные за 22 мая сохранены»

**Сценарий (HH API недоступен):**
- Поле «Звонки» пустое, под ним Alert variant=warning: «Данные о звонках из HH не получены. Введите вручную.»
- Менеджер вводит 25 → сохраняется с `calls_source = 'manual'`
- В интерфейсе рядом с числом иконка `PencilLine` (ручной ввод)

**Сценарий (дата из будущего):**
- DatePicker блокирует выбор дат после сегодня
- API дополнительно: если `activity_date > today` → 422 `FUTURE_DATE_NOT_ALLOWED`

**Критерии приёмки:**
- [ ] Форма открывается за < 1 сек
- [ ] Поле «Звонки» автозаполнено из HH при успешной синхронизации
- [ ] Все числовые поля: integer, min = 0, max = 999
- [ ] Нельзя выбрать дату из будущего (блокировка в DatePicker + валидация на API)
- [ ] Редактирование доступно за последние 7 дней; записи старше 7 дней — только просмотр
- [ ] После сохранения KPI-панель пересчитывается без перезагрузки
- [ ] При `calls_source = 'manual'` — иконка `PencilLine` рядом с числом звонков

---

### US-002: Просмотр воронки по вакансии руководителем

**Как** руководитель HR,
**я хочу** открыть любую вакансию и увидеть полную воронку найма с конверсией на каждом этапе,
**чтобы** понять, где теряются кандидаты, и скорректировать работу менеджера.

**Сценарий (happy path):**
1. Руководитель открывает `/vacancies` — таблица вакансий с краткими KPI
2. Кликает «Менеджер по продажам (Москва)» → `/vacancies/c1d2e3f4-...`
3. Видит воронку: Отклики 120 → Резюме открыты 87 (72%) → Звонки 43 (49%) → Собеседования 12 (28%) → Офферы 3 (25%) → Выведено 2 (67%)
4. Переключает период «Сегодня / Неделя / Месяц / Всё время» — воронка пересчитывается без перезагрузки
5. Видит sparkline (recharts LineChart, 14 точек) динамики откликов и звонков
6. Карточка ответственного менеджера с его KPI по этой вакансии
7. Правый верхний угол: «Данные актуальны на 14:32» с иконкой `Clock`

**Сценарий (нет данных HH):**
- Поля откликов и резюме показывают «—» с Tooltip: «Синхронизация с HH ещё не проводилась»
- Кнопка «Синхронизировать HH» на странице (для head/admin)

**Сценарий (вакансия не найдена):**
- `/vacancies/nonexistent-uuid` → 404-страница: «Вакансия не найдена», кнопка `ArrowLeft` «К списку»

**Критерии приёмки:**
- [ ] Воронка: все 6 этапов с абсолютными числами
- [ ] Конверсия между этапами в % — рядом со стрелкой
- [ ] Фильтр периода пересчитывает воронку без перезагрузки
- [ ] Timestamp «Данные актуальны на HH:MM» присутствует всегда
- [ ] При отсутствии данных HH — явный индикатор «—», не ноль
- [ ] 404 при несуществующем UUID

---

### US-003: Сравнительный дашборд менеджеров для руководителя

**Как** руководитель HR,
**я хочу** видеть KPI всех менеджеров в одной таблице с цветовой индикацией выполнения плана,
**чтобы** объективно оценивать эффективность команды без субъективных суждений.

**Сценарий (happy path):**
1. Руководитель открывает `/dashboard`
2. Сверху 4 KPI-карточки: Звонки/план, Собеседования/план, Выведено/план, Активных вакансий
3. Ниже таблица: Имя | Звонки (факт/план/%) | Собеседования | Выведено | Вакансий | Статус
4. Статус Badge: зелёный «В плане» ≥90%, жёлтый «Отставание» 70–89%, красный «Критично» <70%
5. Переключает период «Сегодня / Эта неделя / Этот месяц» — таблица обновляется
6. Кликает строку «Петров Алексей» → Sheet (боковая панель): разбивка по дням + по вакансиям
7. Нажимает «Экспорт CSV» → скачивается `dashboard_2026-05-22.csv`

**Сценарий (нет данных за период):**
- Таблица показывает нули в факте, план отображается
- Под таблицей: «Активностей за выбранный период не найдено»

**Критерии приёмки:**
- [ ] Таблица загружается за < 2 сек
- [ ] Статус рассчитывается по среднему % трёх KPI (звонки, собеседования, выведено)
- [ ] Sheet открывается без перехода на другую страницу
- [ ] CSV содержит все столбцы + дату генерации в первой строке
- [ ] Роль `executive` не видит имена менеджеров — только агрегаты

---

### US-004: Настройка плана и обновление укомплектованности

**Как** руководитель HR,
**я хочу** задать план KPI для каждого менеджера и вручную обновлять % укомплектованности отдела,
**чтобы** команда видела общую цель и могла оценивать свой прогресс.

**Сценарий план (happy path):**
1. Открывает `/plan` — таблица с текущими планами всех менеджеров
2. Нажимает иконку `Pencil` напротив «Петров Алексей» → ячейки становятся полями ввода
3. Вводит: звонков/день = 25, собеседований/день = 4, лимит вакансий = 8, выводов/месяц = 5
4. «Сохранить» → `POST /api/plans` → toast «План Петрова обновлён с 01.06.2026»
5. Дашборд пересчитывает KPI немедленно

**Сценарий укомплектованность (happy path):**
1. Открывает `/staffing` — крупный показатель «74%»
2. Нажимает «Обновить» → Dialog: поле числа 0–100, поле комментария
3. Вводит 78%, «Закрыли 2 позиции в логистике» → «Сохранить»
4. Цифра обновляется. История снизу: «22.05.2026 · 78% · Иванов Д. · Закрыли 2 позиции в логистике»

**Сценарий (ошибка валидации):**
- Ввод 101% → поле красное, tooltip «Значение от 0 до 100»
- Отрицательное число в плане → inline-ошибка под полем

**Критерии приёмки:**
- [ ] Новый план сохраняется с `effective_from` (по умолчанию: 1-е число следующего месяца)
- [ ] Старый план не удаляется — хранится история
- [ ] `staffing_pct`: integer 0–100, иначе 422
- [ ] История изменений укомплектованности: последние 20 записей
- [ ] Только роли `head` и `admin` могут редактировать

---

### US-005: Автоматическая синхронизация HH.ru (cron)

**Как** cron-задача (Beget VPS),
**я хочу** каждые 2 часа в рабочее время забирать статистику из HH.ru API,
**чтобы** данные по откликам и резюме были актуальны без ручного запуска.

**Сценарий (happy path):**
1. pm2 запускает `sync-hh.ts` по расписанию `0 8,10,12,14,16,18,20,22 * * 1-5`
2. Создаётся запись `sync_logs` со `status = 'running'`
3. Читаются все `vacancies` со `status = 'active'` и непустым `hh_vacancy_id`
4. Для каждой: берётся `hh_access_token` ответственного менеджера из `user_profiles`
5. `GET https://api.hh.ru/vacancies/{hh_vacancy_id}` с `Authorization: Bearer {token}`
6. Из ответа: `counters.responses` (отклики), `counters.views` (просмотры)
7. INSERT в `vacancy_snapshots`
8. `sync_logs` обновляется: `status = 'ok'`, `records_updated = N`, `finished_at = now()`

**Сценарий (токен истёк — 401):**
1. Пытается refresh: `POST https://hh.ru/oauth/token` body `grant_type=refresh_token&refresh_token={token}`
2. Если refresh успешен → обновляет `user_profiles` → повторяет запрос
3. Если refresh тоже 401 → логирует `HH_TOKEN_EXPIRED` в `sync_logs`
4. Telegram: «⚠️ Требуется переавторизация HH для менеджера: Иванова Мария»
5. Переходит к следующей вакансии

**Критерии приёмки:**
- [ ] Каждый запуск логируется: время старта, финиша, статус, кол-во записей
- [ ] При 401 — попытка refresh перед пометкой ошибки
- [ ] При ошибке — данные в БД не затираются
- [ ] Telegram-уведомление при неустранимой ошибке
- [ ] Retry для transient-ошибок: 3 попытки с backoff 1с → 2с → 4с

---

### US-006: Синхронизация закрытых вакансий из Google Sheets

**Как** руководитель HR,
**я хочу** нажать одну кнопку и загрузить из Google Sheets данные о закрытых вакансиях,
**чтобы** видеть срок закрытия каждой позиции и фиксировать факт найма.

**Сценарий (happy path):**
1. Открывает `/sync` → 2 карточки: HH.ru, Google Sheets — статус последней синхронизации
2. В карточке Google Sheets нажимает «Синхронизировать» → кнопка `disabled` + `Loader2` spin
3. `POST /api/sync/sheets` → читает все строки файла через Google Sheets API v4
4. Фильтр: столбец «Статус» = «закрыта» AND столбец «Дата закрытия» заполнена
5. Для каждой строки: обновляет `vacancies.closed_at` и `status = 'closed'`, upsert `hired_employees`
6. `days_to_close` пересчитывается автоматически (GENERATED ALWAYS AS STORED)
7. Toast: «Google Sheets синхронизирован: 4 вакансии закрыты, 2 без привязки»

**Сценарий (нет доступа к Sheets):**
- `sync_logs`: `status = 'error'`, `error_code = 'SHEETS_AUTH_ERROR'`
- Toast destructive: «Ошибка доступа к Google Sheets. Проверьте service account в настройках.»

**Критерии приёмки:**
- [ ] Фильтр: статус = «закрыта» AND дата закрытия непустая — строгое условие
- [ ] Повторный запуск невозможен пока идёт текущий (кнопка `disabled`)
- [ ] Кнопка недоступна для роли `manager`
- [ ] После синхронизации `days_to_close` заполнен у всех закрытых вакансий
- [ ] История синхронизаций на `/sync/logs`

---

### US-007: Дашборд топ-менеджера (только агрегаты)

**Как** топ-менеджер,
**я хочу** видеть % укомплектованности и общую динамику найма,
**чтобы** контролировать кадровую ситуацию без погружения в детали.

**Сценарий (happy path):**
1. Логинится → redirect на `/dashboard` (executive layout)
2. Центр: крупный `Card` «78%» (font-size 96px), цвет зависит от значения
3. Под числом: «Обновлено 20.05.2026 · Закрыли 2 позиции в логистике»
4. Два графика: «Выведено по месяцам» (bar chart), «Открытые вакансии» (line chart)
5. НЕТ таблицы менеджеров. НЕТ кнопок редактирования.

**Критерии приёмки:**
- [ ] Роль `executive`: RLS скрывает имена менеджеров, только агрегаты
- [ ] Нет ни одной кнопки создания/редактирования на странице
- [ ] Загрузка < 2 сек

---

## БЛОК 2: Data Model

### Диаграмма связей (ASCII)

```
auth.users (Supabase built-in)
    │
    │ 1:1
    ▼
user_profiles
    │ role, full_name, email, is_active
    │ hh_access_token, hh_refresh_token, hh_token_expires_at
    │
    ├── 1:N ──► daily_activities (activity_date, hh_calls_count, interviews, offers)
    │
    ├── 1:N ──► vacancies (title, subdivision, department, hh_vacancy_id, opened_at, closed_at, days_to_close)
    │               │
    │               ├── 1:N ──► vacancy_snapshots (responses, contacts_opened, invitations_sent, views)
    │               │
    │               └── 1:N ──► hired_employees (sheet_row_id, employment_type: employee|intern)
    │                               └── bonus via hr_bonuses.vacancy_id
    │
    ├── 1:N ──► manager_plans (calls_per_day=15, interviews_per_day=5, hires_per_month=15)
    │
    ├── 1:N ──► hr_bonuses (vacancy_id, bonus_amount_kopecks, status: pending|paid)
    │               └── manager_id FK
    │
    └── 1:N ──► staffing_records (staffing_pct, recorded_by)

hr_manager_syncs (лист «HR менеджеры» Sheets → user_profiles сопоставление)
    └── sheet_full_name → user_profile_id FK (nullable)
    └── используется hr_bonuses для разрешения имён из листа Бонусы_HR

sync_logs    (source: hh | mango | hh_csv | sheets — автономная таблица)
audit_logs   (table_name + record_id + old/new values — триггеры на ключевых таблицах)
error_logs   (source + severity + message — пишут API routes и cron скрипты)
```

### Шаг 0: расширения Supabase (выполнить первыми)

```sql
-- Выполнить в Supabase SQL Editor до создания таблиц:
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS moddatetime;     -- триггер updated_at
CREATE EXTENSION IF NOT EXISTS pg_trgm;         -- fuzzy match по названию должности
```

---

### Таблица: `user_profiles`

```sql
-- Профили пользователей. id = auth.users.id (Supabase Auth).
-- Создаётся автоматически через trigger при добавлении пользователя через Dashboard.
CREATE TABLE public.user_profiles (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name            TEXT NOT NULL
                         CHECK (char_length(full_name) BETWEEN 2 AND 100),
  role                 TEXT NOT NULL DEFAULT 'manager'
                         CHECK (role IN ('manager', 'head', 'executive', 'admin')),
  email                TEXT NOT NULL UNIQUE
                         CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  -- HH.ru OAuth токены менеджера. NULL для ролей head/admin/executive.
  hh_access_token      TEXT,
  hh_refresh_token     TEXT,
  hh_token_expires_at  TIMESTAMPTZ,
  -- ID менеджера в системе HH работодателя (для фильтрации статистики звонков HH)
  hh_manager_id        TEXT,
  -- Добавочный номер в Манго ВATС. По нему фильтруем историю через vpbx/stats/request.
  -- NULL если менеджер не использует Манго (звонит только через HH).
  mango_extension      TEXT CHECK (mango_extension ~ '^\d{2,6}$' OR mango_extension IS NULL),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_role   ON public.user_profiles(role);
CREATE INDEX idx_user_profiles_active ON public.user_profiles(is_active)
  WHERE is_active = TRUE;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Каждый видит свой профиль. head/admin видят все активные профили.
CREATE POLICY "profiles_select" ON public.user_profiles
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Пользователь обновляет только свой профиль (имя, расширение).
CREATE POLICY "profiles_update_own" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin управляет всеми профилями.
CREATE POLICY "profiles_admin_all" ON public.user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Trigger: создать профиль при регистрации через Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Новый пользователь'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'manager')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

### Таблица: `vacancies`

```sql
-- Вакансии HR-отдела. Один ответственный менеджер на вакансию.
CREATE TABLE public.vacancies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Числовой ID вакансии на HH.ru (например "98765432"). NULL если не привязана к HH.
  hh_vacancy_id  TEXT UNIQUE,
  title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  department     TEXT CHECK (char_length(department) <= 100),
  -- Подразделение компании (из Sheets, для аналитики по подразделениям)
  subdivision    TEXT CHECK (char_length(subdivision) <= 100),
  manager_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'paused', 'closed', 'draft')),
  opened_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_at      DATE CHECK (closed_at IS NULL OR closed_at >= opened_at),
  -- Вычисляемый срок закрытия в календарных днях (closed_at - opened_at).
  -- NULL пока вакансия активна. Заполняется автоматически при установке closed_at.
  -- Источник данных: Google Sheets файл (столбцы «Дата открытия» и «Дата закрытия»),
  -- импортируется через /api/admin/vacancies/import или вручную.
  days_to_close  INTEGER GENERATED ALWAYS AS (
    CASE WHEN closed_at IS NOT NULL
         THEN (closed_at - opened_at)::INTEGER
         ELSE NULL
    END
  ) STORED,
  -- Номер строки в Google Sheets для двустороннего сопоставления при импорте
  google_sheet_row INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vacancies_manager_id  ON public.vacancies(manager_id);
CREATE INDEX idx_vacancies_status      ON public.vacancies(status);
CREATE INDEX idx_vacancies_hh_id       ON public.vacancies(hh_vacancy_id)
  WHERE hh_vacancy_id IS NOT NULL;
-- Для fuzzy-match по названию при Google Sheets-синхронизации
CREATE INDEX idx_vacancies_title_trgm  ON public.vacancies USING gin(title gin_trgm_ops);

ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;

-- manager видит только свои; head/admin/executive — все
CREATE POLICY "vacancies_select" ON public.vacancies
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
    )
  );

-- head/admin создают и редактируют вакансии
CREATE POLICY "vacancies_write" ON public.vacancies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

CREATE TRIGGER vacancies_updated_at
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `vacancy_snapshots`

```sql
-- Снимки статистики HH.ru по вакансии. Только INSERT — не UPDATE.
-- Для актуальных данных берётся последний snapshot по snapshot_at DESC.
CREATE TABLE public.vacancy_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id           UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  snapshot_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Данные из HH API: общая воронка по вакансии
  responses_count      INTEGER NOT NULL DEFAULT 0 CHECK (responses_count >= 0),
  -- Кол-во резюме, по которым менеджер открыл контакт (просмотрел телефон/email)
  contacts_opened      INTEGER NOT NULL DEFAULT 0 CHECK (contacts_opened >= 0),
  -- Кол-во приглашений, отправленных кандидатам через HH
  invitations_sent     INTEGER NOT NULL DEFAULT 0 CHECK (invitations_sent >= 0),
  -- Кол-во просмотров резюме (открытых карточек без раскрытия контакта)
  views_count          INTEGER NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  -- 'hh_api' = автоматически cron; 'manual' = введено вручную
  source               TEXT NOT NULL DEFAULT 'hh_api'
                         CHECK (source IN ('hh_api', 'manual')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Нет updated_at — snapshot иммутабелен
);

CREATE INDEX idx_snapshots_vacancy_id ON public.vacancy_snapshots(vacancy_id);
-- DESC для быстрого получения последнего snapshot
CREATE INDEX idx_snapshots_at_desc    ON public.vacancy_snapshots(vacancy_id, snapshot_at DESC);

ALTER TABLE public.vacancy_snapshots ENABLE ROW LEVEL SECURITY;

-- Читают те же роли, что видят вакансию
CREATE POLICY "snapshots_select" ON public.vacancy_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vacancies v
      WHERE v.id = vacancy_id AND (
        v.manager_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
        )
      )
    )
  );

-- INSERT только через service_role (cron и API-эндпоинты используют SUPABASE_SERVICE_ROLE_KEY)
-- WITH CHECK (TRUE) означает: RLS не блокирует вставку для service_role
CREATE POLICY "snapshots_service_insert" ON public.vacancy_snapshots
  FOR INSERT WITH CHECK (TRUE);
```

---

### Таблица: `daily_activities`

```sql
-- Ежедневные активности HR-менеджера.
-- UNIQUE(manager_id, activity_date) — одна запись на менеджера в день.
-- При повторном сохранении — upsert (UPDATE существующей записи).
CREATE TABLE public.daily_activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id           UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  activity_date        DATE NOT NULL,

  -- === ЗВОНКИ ===
  -- Источник 1: Манго ВATС API — cron в 20:00, vpbx/stats/request по from.extension менеджера.
  -- NULL если менеджер не использует Манго (mango_extension IS NULL).
  mango_calls_count    INTEGER CHECK (mango_calls_count BETWEEN 0 AND 999),
  mango_calls_source   TEXT NOT NULL DEFAULT 'pending'
                         CHECK (mango_calls_source IN ('mango_api', 'manual', 'pending')),

  -- Источник 2: HH встроенные звонки — из CSV «Аналитика подбора → Менеджеры → Звонки».
  -- NULL если менеджер не использует HH-звонки (hh_manager_id IS NULL).
  hh_calls_count       INTEGER CHECK (hh_calls_count BETWEEN 0 AND 999),
  hh_calls_source      TEXT NOT NULL DEFAULT 'pending'
                         CHECK (hh_calls_source IN ('hh_csv', 'manual', 'pending')),

  -- Итого звонков = COALESCE(mango_calls_count, 0) + COALESCE(hh_calls_count, 0).
  -- Рассчитывается на сервере при запросе, не хранится отдельным полем.

  -- === СОБЕСЕДОВАНИЯ (вводятся вручную менеджером) ===
  interviews_count     INTEGER NOT NULL DEFAULT 0 CHECK (interviews_count BETWEEN 0 AND 999),

  -- === ОФФЕРЫ (вводятся вручную менеджером) ===
  offers_count         INTEGER NOT NULL DEFAULT 0 CHECK (offers_count BETWEEN 0 AND 999),

  notes                TEXT CHECK (char_length(notes) <= 1000),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (manager_id, activity_date)
);

CREATE INDEX idx_activities_manager_id   ON public.daily_activities(manager_id);
CREATE INDEX idx_activities_date_desc    ON public.daily_activities(activity_date DESC);
CREATE INDEX idx_activities_manager_date ON public.daily_activities(manager_id, activity_date DESC);

ALTER TABLE public.daily_activities ENABLE ROW LEVEL SECURITY;

-- Менеджер управляет только своими записями
CREATE POLICY "activities_manager_own" ON public.daily_activities
  FOR ALL
  USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());

-- head/admin читают все активности (для дашборда)
CREATE POLICY "activities_head_select" ON public.daily_activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- service_role (cron HH) обновляет hh_calls_count
CREATE POLICY "activities_service_upsert" ON public.daily_activities
  FOR ALL WITH CHECK (TRUE);

CREATE TRIGGER daily_activities_updated_at
  BEFORE UPDATE ON public.daily_activities
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `hired_employees`

```sql
-- Закрытые вакансии с трудоустройством. Источник: Google Sheets.
-- Условие импорта: столбец «Статус» = «закрыта» AND столбец «Дата закрытия» заполнена.
-- sheet_row_id — номер строки в Google Sheets, ключ для idempotent upsert.
CREATE TABLE public.hired_employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Номер строки в Google Sheets (уникальный ключ для upsert при повторной синхронизации)
  sheet_row_id      INTEGER NOT NULL UNIQUE,
  -- Вакансия определяется по названию через fuzzy-match (pg_trgm, threshold 0.8)
  -- или по прямому совпадению с vacancies.title
  vacancy_id        UUID REFERENCES public.vacancies(id) ON DELETE SET NULL,
  -- Название вакансии из Sheets (для логов и ручной корректировки при NULL vacancy_id)
  position_name     TEXT NOT NULL CHECK (char_length(position_name) BETWEEN 2 AND 200),
  -- Дата закрытия из столбца «Дата закрытия» Google Sheets
  hired_date        DATE NOT NULL,
  -- 'employee' = трудоустроен; 'intern' = стажёр (промежуточный этап воронки)
  -- 'intern' — человек принят, но ещё на стажировке; не считается закрытием вакансии
  employment_type   TEXT NOT NULL DEFAULT 'employee'
                      CHECK (employment_type IN ('employee', 'intern')),
  -- ФИО менеджера из Sheets (для привязки бонуса если vacancy_id = NULL)
  manager_name_sheet TEXT CHECK (char_length(manager_name_sheet) <= 100),
  -- Timestamp последней синхронизации из Sheets
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hired_vacancy_id  ON public.hired_employees(vacancy_id);
CREATE INDEX idx_hired_date_desc   ON public.hired_employees(hired_date DESC);
CREATE INDEX idx_hired_synced_at   ON public.hired_employees(synced_at DESC);

ALTER TABLE public.hired_employees ENABLE ROW LEVEL SECURITY;

-- manager видит только тех, кто привязан к его вакансиям
CREATE POLICY "hired_select" ON public.hired_employees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vacancies v
      WHERE v.id = vacancy_id AND v.manager_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
    )
  );

-- Только service_role (sync Sheets) пишет
CREATE POLICY "hired_service_write" ON public.hired_employees
  FOR ALL WITH CHECK (TRUE);

CREATE TRIGGER hired_employees_updated_at
  BEFORE UPDATE ON public.hired_employees
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `ai_insights`

```sql
-- Хранит результаты AI-анализа: аномалии, прогнозы, рекомендации и еженедельные отчёты.
-- Генерируются cron (еженедельно) и on-demand (по кнопке руководителя).
-- Не редактируются после создания — только INSERT.
CREATE TABLE public.ai_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Тип инсайта
  insight_type    TEXT NOT NULL
                    CHECK (insight_type IN (
                      'anomaly',        -- аномалия активности менеджера
                      'forecast',       -- прогноз выполнения плана
                      'recommendation', -- рекомендация по воронке вакансии
                      'weekly_report'   -- еженедельный отчёт руководителю
                    )),
  -- Период анализа
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  -- Привязка (nullable — weekly_report не привязан к одному объекту)
  manager_id      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  vacancy_id      UUID REFERENCES public.vacancies(id) ON DELETE SET NULL,
  -- Severity только для аномалий: low / medium / high
  severity        TEXT CHECK (severity IN ('low', 'medium', 'high') OR severity IS NULL),
  -- Краткий заголовок (1 строка, для списка)
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  -- Полный AI-текст (Markdown, для детального просмотра)
  body_md         TEXT NOT NULL,
  -- Структурированные данные для UI (JSON): метрики, на которых основан вывод
  meta_json       JSONB,
  -- Прочитан ли руководителем
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Токены потраченные на генерацию (для мониторинга стоимости)
  tokens_used     INTEGER,
  -- Кто запустил: 'cron' или UUID пользователя
  triggered_by    TEXT NOT NULL DEFAULT 'cron',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_insights_type        ON public.ai_insights(insight_type);
CREATE INDEX idx_ai_insights_manager_id  ON public.ai_insights(manager_id);
CREATE INDEX idx_ai_insights_vacancy_id  ON public.ai_insights(vacancy_id);
CREATE INDEX idx_ai_insights_created_at  ON public.ai_insights(created_at DESC);
CREATE INDEX idx_ai_insights_unread      ON public.ai_insights(is_read) WHERE is_read = FALSE;

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только инсайты о себе; head/admin — все
CREATE POLICY "ai_insights_manager_own" ON public.ai_insights
  FOR SELECT USING (
    manager_id = auth.uid()
    OR manager_id IS NULL  -- weekly_report виден всем авторизованным head/admin
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
CREATE POLICY "ai_insights_service_write" ON public.ai_insights
  FOR ALL WITH CHECK (TRUE);
```

---

### Таблица: `hr_manager_syncs`

```sql
-- Список действующих HR-менеджеров из листа «HR менеджеры» Google Sheets.
-- Синхронизируется при каждом запуске /api/sync/sheets.
-- КЛЮЧЕВОЕ ПРАВИЛО: является единственным списком «своих» менеджеров.
-- При загрузке любого CSV из HH — берём в анализ ТОЛЬКО менеджеров,
-- чьё имя есть в этой таблице (sheet_full_name). Остальные — игнорируются.
-- Это исключает чужих менеджеров, которые могут присутствовать в HH-отчётах.
CREATE TABLE public.hr_manager_syncs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Строка из Sheets: ФИО менеджера (точно как написано в Sheets)
  sheet_full_name    TEXT NOT NULL UNIQUE CHECK (char_length(sheet_full_name) BETWEEN 2 AND 100),
  -- Привязка к auth-пользователю. NULL если имя не сопоставлено.
  user_profile_id    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- mango_extension хранится в user_profiles напрямую, здесь не дублируется
  email_sheet        TEXT,
  is_active_sheet    BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hr_sync_user_id   ON public.hr_manager_syncs(user_profile_id);
CREATE INDEX idx_hr_sync_name      ON public.hr_manager_syncs(sheet_full_name);

ALTER TABLE public.hr_manager_syncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_syncs_head_select" ON public.hr_manager_syncs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
CREATE POLICY "hr_syncs_service_write" ON public.hr_manager_syncs
  FOR ALL WITH CHECK (TRUE);

CREATE TRIGGER hr_manager_syncs_updated_at
  BEFORE UPDATE ON public.hr_manager_syncs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `hr_bonuses`

```sql
-- Бонусы HR-менеджеров из листа «Бонусы_HR» Google Sheets.
-- Сопоставление: bonus.vacancy_title → vacancies.title (fuzzy-match pg_trgm threshold 0.8)
--                bonus.manager_name  → hr_manager_syncs.sheet_full_name (точное совпадение)
CREATE TABLE public.hr_bonuses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Номер строки в листе Бонусы_HR (ключ upsert)
  sheet_row_id        INTEGER NOT NULL UNIQUE,
  -- Привязка к менеджеру через hr_manager_syncs
  manager_sync_id     UUID REFERENCES public.hr_manager_syncs(id) ON DELETE SET NULL,
  -- Прямая привязка к user_profiles (если совпадение найдено)
  manager_id          UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- Привязка к вакансии через fuzzy-match по названию
  vacancy_id          UUID REFERENCES public.vacancies(id) ON DELETE SET NULL,
  -- Сырые данные из Sheets (для логов и ручной корректировки)
  vacancy_title_sheet TEXT NOT NULL CHECK (char_length(vacancy_title_sheet) BETWEEN 2 AND 200),
  manager_name_sheet  TEXT NOT NULL CHECK (char_length(manager_name_sheet) BETWEEN 2 AND 100),
  -- Сумма бонуса в копейках (INTEGER по правилу валюты)
  -- Пример: 50000 руб. → 5000000 копеек
  bonus_amount_kopecks INTEGER NOT NULL CHECK (bonus_amount_kopecks >= 0),
  bonus_date          DATE NOT NULL,
  -- Статус: 'pending' = начислен, 'paid' = выплачен
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid')),
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bonuses_manager_id  ON public.hr_bonuses(manager_id);
CREATE INDEX idx_bonuses_vacancy_id  ON public.hr_bonuses(vacancy_id);
CREATE INDEX idx_bonuses_date_desc   ON public.hr_bonuses(bonus_date DESC);
CREATE INDEX idx_bonuses_status      ON public.hr_bonuses(status);

ALTER TABLE public.hr_bonuses ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только свои бонусы
CREATE POLICY "bonuses_manager_own" ON public.hr_bonuses
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
CREATE POLICY "bonuses_service_write" ON public.hr_bonuses
  FOR ALL WITH CHECK (TRUE);

CREATE TRIGGER hr_bonuses_updated_at
  BEFORE UPDATE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `hh_manager_stats`

```sql
-- Статистика по менеджерам из CSV-выгрузок HH «Аналитика подбора».
-- Источник: три CSV-отчёта HH (загружаются вручную через /sync):
--   1. «Менеджеры → Звонки» → hh_calls_count
--   2. «Менеджеры → Индекс вежливости менеджеров» → responses_received, viewed, answered, politeness_index
--   3. «Компания → Индекс вежливости компании» → хранится в отдельной строке с manager_id = NULL
-- Ключ upsert: (manager_id, stat_date) — одна запись на менеджера в день.
-- Для ИВ компании: manager_id = NULL, stat_date = дата отчёта.
CREATE TABLE public.hh_manager_stats (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = строка относится к компании в целом (индекс вежливости компании)
  manager_id          UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  -- Имя менеджера из CSV (для сопоставления если manager_id не найден)
  manager_name_hh     TEXT CHECK (char_length(manager_name_hh) <= 100),
  stat_date           DATE NOT NULL,

  -- === ИЗ CSV «ЗВОНКИ» ===
  -- Кол-во звонков рекрутёра через встроенную функцию HH за дату
  hh_calls_count      INTEGER CHECK (hh_calls_count >= 0),

  -- === ИЗ CSV «ИНДЕКС ВЕЖЛИВОСТИ МЕНЕДЖЕРОВ» ===
  -- Получено откликов (на вакансии менеджера за дату)
  responses_received  INTEGER CHECK (responses_received >= 0),
  -- БЕСПЛАТНО: просмотры резюме из ВХОДЯЩИХ откликов. UI label
  -- «Просмотры (отклики)». Источник CSV «Просмотры резюме из отклика, шт.».
  responses_viewed    INTEGER CHECK (responses_viewed >= 0),
  -- Отправлено ответов кандидатам
  responses_answered  INTEGER CHECK (responses_answered >= 0),
  -- ⓟ ПЛАТНО: просмотры резюме, найденных менеджером через поиск/базу HH.
  -- UI label «💰 Просмотры (поиск)». Источник CSV «Просмотры резюме из поиска, шт.».
  resume_views_from_search  INTEGER CHECK (resume_views_from_search IS NULL OR resume_views_from_search >= 0),
  -- ⓟ ПЛАТНО: приглашения по контактам из базы резюме HH.
  -- UI label «💰 Приглашения из базы». Источник CSV «Приглашений из базы резюме, шт.».
  invitations_from_db       INTEGER CHECK (invitations_from_db IS NULL OR invitations_from_db >= 0),
  -- Индекс вежливости: 0–100, рассчитывается HH
  -- Для manager_id = NULL → индекс вежливости компании
  politeness_index    NUMERIC(5,2) CHECK (politeness_index BETWEEN 0 AND 100),
  -- Среднее время ответа кандидатам (в часах, из CSV)
  avg_response_hours  NUMERIC(6,1) CHECK (avg_response_hours >= 0),

  -- Из какого CSV файла загружено
  source_csv          TEXT NOT NULL
                        CHECK (source_csv IN ('calls', 'politeness_managers', 'politeness_company')),
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Уникальность: один менеджер / одна компания — один день
  UNIQUE (manager_id, stat_date, source_csv)
);

CREATE INDEX idx_hh_stats_manager_id ON public.hh_manager_stats(manager_id);
CREATE INDEX idx_hh_stats_date_desc  ON public.hh_manager_stats(stat_date DESC);
CREATE INDEX idx_hh_stats_company    ON public.hh_manager_stats(stat_date DESC) WHERE manager_id IS NULL;

ALTER TABLE public.hh_manager_stats ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только свои строки; ИВ компании (manager_id=NULL) — все авторизованные
CREATE POLICY "hh_stats_manager_own" ON public.hh_manager_stats
  FOR SELECT USING (
    manager_id = auth.uid()
    OR manager_id IS NULL  -- ИВ компании виден всем
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
CREATE POLICY "hh_stats_service_write" ON public.hh_manager_stats
  FOR ALL WITH CHECK (TRUE);

CREATE TRIGGER hh_manager_stats_updated_at
  BEFORE UPDATE ON public.hh_manager_stats
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
```

---

### Таблица: `manager_plans`

```sql
-- Планы KPI по менеджеру. При изменении плана — INSERT новой записи, старая остаётся.
-- Активный план = последняя запись WHERE manager_id = X AND effective_from <= CURRENT_DATE.
CREATE TABLE public.manager_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- План: 15 звонков в день (через встроенные звонки HH.ru).
  calls_per_day        INTEGER NOT NULL DEFAULT 15 CHECK (calls_per_day BETWEEN 0 AND 200),
  -- План: 5 собеседований в день (ручной ввод менеджера).
  interviews_per_day   INTEGER NOT NULL DEFAULT 5  CHECK (interviews_per_day BETWEEN 0 AND 50),
  -- План: 15 закрытых вакансий в месяц (по всему отделу или на менеджера — задаётся явно).
  hires_per_month      INTEGER NOT NULL DEFAULT 15 CHECK (hires_per_month BETWEEN 0 AND 100),
  -- Лимит вакансий одного менеджера одновременно (15 вакансий / 5 менеджеров = 3; берём с запасом).
  vacancies_limit      INTEGER NOT NULL DEFAULT 5  CHECK (vacancies_limit BETWEEN 0 AND 100),
  set_by              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Нет updated_at: план не редактируется, только добавляется новая версия
);

CREATE INDEX idx_plans_manager_id     ON public.manager_plans(manager_id);
CREATE INDEX idx_plans_effective_from ON public.manager_plans(manager_id, effective_from DESC);

ALTER TABLE public.manager_plans ENABLE ROW LEVEL SECURITY;

-- Менеджер читает свой план
CREATE POLICY "plans_manager_select" ON public.manager_plans
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Только head/admin создают планы
CREATE POLICY "plans_head_insert" ON public.manager_plans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );
```

---

### Таблица: `staffing_records`

```sql
-- История % укомплектованности. Вносится вручную руководителем.
-- Текущее значение = последняя запись по recorded_at.
CREATE TABLE public.staffing_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staffing_pct  INTEGER NOT NULL CHECK (staffing_pct BETWEEN 0 AND 100),
  comment       TEXT CHECK (char_length(comment) <= 500),
  recorded_by   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Нет updated_at: запись не редактируется, только добавляется новая
);

CREATE INDEX idx_staffing_recorded_at ON public.staffing_records(recorded_at DESC);

ALTER TABLE public.staffing_records ENABLE ROW LEVEL SECURITY;

-- Все авторизованные видят (% укомплектованности — мотивационный элемент для всего отдела)
CREATE POLICY "staffing_select_all" ON public.staffing_records
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Только head/admin создают
CREATE POLICY "staffing_insert_head" ON public.staffing_records
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );
```

---

### Таблица: `sync_logs`

```sql
-- Журнал синхронизаций (HH API cron, HH CSV upload, Google Sheets). Только INSERT.
CREATE TABLE public.sync_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source           TEXT NOT NULL CHECK (source IN ('hh', 'mango', 'hh_csv', 'sheets')),
  status           TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
  records_total    INTEGER NOT NULL DEFAULT 0,
  records_updated  INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  error_message    TEXT CHECK (char_length(error_message) <= 1000),
  -- 'cron' или UUID пользователя, запустившего вручную
  triggered_by     TEXT NOT NULL DEFAULT 'cron',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
  -- Нет updated_at: лог иммутабелен (статус обновляется отдельным UPDATE через service_role)
);

CREATE INDEX idx_sync_logs_source  ON public.sync_logs(source);
CREATE INDEX idx_sync_logs_started ON public.sync_logs(started_at DESC);
CREATE INDEX idx_sync_logs_status  ON public.sync_logs(status);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_logs_select" ON public.sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Пишут и обновляют только cron и API-эндпоинты через service_role
CREATE POLICY "sync_logs_service_all" ON public.sync_logs
  FOR ALL WITH CHECK (TRUE);
```

---

### Таблица: `audit_logs`

```sql
-- Audit trail: кто, когда и что изменил. Только INSERT, никогда не UPDATE/DELETE.
-- Покрывает ключевые таблицы: user_profiles, vacancies, manager_plans,
-- staffing_records, hired_employees, hr_bonuses, manager_plans.
-- Триггеры создаются на каждую отслеживаемую таблицу.
CREATE TABLE public.audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Кто сделал изменение (NULL если действие системное: cron, sync)
  user_id        UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  user_role      TEXT CHECK (user_role IN ('manager','head','executive','admin','system')),
  -- Что изменилось
  table_name     TEXT NOT NULL CHECK (char_length(table_name) <= 60),
  record_id      UUID NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  -- Снимки до и после изменения (только изменённые поля для UPDATE)
  old_values     JSONB,  -- NULL для INSERT
  new_values     JSONB,  -- NULL для DELETE
  -- Мета-данные запроса
  ip_address     INET,
  user_agent     TEXT CHECK (char_length(user_agent) <= 500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX idx_audit_user_id      ON public.audit_logs(user_id);
CREATE INDEX idx_audit_created_at   ON public.audit_logs(created_at DESC);
-- Для поиска всех изменений за период
CREATE INDEX idx_audit_created_date ON public.audit_logs(created_at DESC)
  WHERE action IN ('UPDATE', 'DELETE');

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Только admin читает audit logs
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
-- Пишет только service_role (триггерные функции)
CREATE POLICY "audit_logs_service_write" ON public.audit_logs
  FOR INSERT WITH CHECK (TRUE);

-- ── Триггерная функция для автоматической записи audit log ────────────────
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID;
  v_user_role TEXT;
  v_old       JSONB;
  v_new       JSONB;
BEGIN
  -- Получаем текущего пользователя из Supabase Auth
  BEGIN
    v_user_id := auth.uid();
    SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_user_id   := NULL;
    v_user_role := 'system'; -- cron или service_role
  END;

  IF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Сохраняем только изменившиеся поля (not equal значения)
    SELECT
      jsonb_object_agg(key, value) INTO v_old
    FROM jsonb_each(to_jsonb(OLD))
    WHERE value IS DISTINCT FROM (to_jsonb(NEW))->key;

    SELECT
      jsonb_object_agg(key, value) INTO v_new
    FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM (to_jsonb(OLD))->key;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
  END IF;

  INSERT INTO public.audit_logs
    (user_id, user_role, table_name, record_id, action, old_values, new_values)
  VALUES
    (v_user_id, COALESCE(v_user_role,'system'), TG_TABLE_NAME,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
     TG_OP, v_old, v_new);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Подключение триггеров к ключевым таблицам ─────────────────────────────
-- Выполнить для каждой таблицы которую нужно отслеживать:
CREATE TRIGGER audit_user_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_vacancies
  AFTER INSERT OR UPDATE OR DELETE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_manager_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.manager_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_staffing_records
  AFTER INSERT OR DELETE ON public.staffing_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_hired_employees
  AFTER INSERT OR UPDATE OR DELETE ON public.hired_employees
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER audit_hr_bonuses
  AFTER INSERT OR UPDATE OR DELETE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- daily_activities НЕ логируем (очень частые изменения, хранить неэффективно)
-- vacancy_snapshots НЕ логируем (только INSERT, иммутабельны)
-- hh_manager_stats НЕ логируем (перезаписываются при каждой загрузке CSV)
```

---

### Таблица: `error_logs`

```sql
-- Журнал ошибок приложения: упавшие API, cron-скрипты, необработанные исключения.
-- Только INSERT. Хранятся 90 дней, затем удаляются (pg_cron или внешний cleanup).
CREATE TABLE public.error_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Источник ошибки
  source         TEXT NOT NULL CHECK (source IN (
    'api',          -- Next.js API route
    'cron_hh',      -- cron sync-hh.ts
    'cron_mango',   -- cron sync-mango.ts
    'cron_ai',      -- cron generate-weekly-report.ts
    'sync_sheets',  -- синхронизация Google Sheets
    'hh_csv_upload',-- загрузка CSV из HH
    'client'        -- фронтенд (необработанные ошибки JS)
  )),
  -- Уровень серьёзности
  severity       TEXT NOT NULL DEFAULT 'error'
                   CHECK (severity IN ('warning', 'error', 'critical')),
  -- Код ошибки (машинночитаемый, для фильтрации)
  error_code     TEXT CHECK (char_length(error_code) <= 100),
  -- Сообщение и стек
  message        TEXT NOT NULL CHECK (char_length(message) <= 2000),
  stack_trace    TEXT CHECK (char_length(stack_trace) <= 10000),
  -- Контекст: что делал пользователь / скрипт (JSON)
  -- Например: { "endpoint": "/api/sync/sheets", "manager_id": "...", "vacancy_id": "..." }
  context        JSONB,
  -- Кто был авторизован (NULL для cron)
  user_id        UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- HTTP-данные (только для source='api')
  http_method    TEXT CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE') OR http_method IS NULL),
  http_path      TEXT CHECK (char_length(http_path) <= 500),
  http_status    INTEGER,
  -- Разрешена ли эта ошибка (admin отмечает как "изучено")
  resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_error_source      ON public.error_logs(source);
CREATE INDEX idx_error_severity    ON public.error_logs(severity);
CREATE INDEX idx_error_created_at  ON public.error_logs(created_at DESC);
CREATE INDEX idx_error_unresolved  ON public.error_logs(resolved, created_at DESC)
  WHERE resolved = FALSE;
-- Для автоочистки старых записей
CREATE INDEX idx_error_cleanup     ON public.error_logs(created_at)
  WHERE created_at < NOW() - INTERVAL '90 days';

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Только admin читает и управляет error_logs
CREATE POLICY "error_logs_admin" ON public.error_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
-- service_role пишет (cron + API через SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "error_logs_service_write" ON public.error_logs
  FOR INSERT WITH CHECK (TRUE);

-- Автоочистка записей старше 90 дней (выполнять через pg_cron или внешний cron)
-- SELECT cron.schedule('cleanup-error-logs', '0 3 * * *',
--   $$DELETE FROM public.error_logs WHERE created_at < NOW() - INTERVAL '90 days'$$);
```

---

## БЛОК 3: API Endpoints

Все эндпоинты в `app/api/` (Next.js App Router).
Аутентификация: Supabase JWT из cookie (SSR-клиент `@supabase/ssr`).
Для cron-скриптов на Beget VPS используется `SUPABASE_SERVICE_ROLE_KEY` напрямую.

**Вспомогательные функции (создать в `lib/api-helpers.ts`):**

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function getAuthUser() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value } }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, 'UNAUTHORIZED', 'Требуется авторизация');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, full_name, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active)
    throw new ApiError(403, 'FORBIDDEN', 'Аккаунт деактивирован');

  return { user, role: profile.role as string, fullName: profile.full_name };
}

export function requireRole(userRole: string, allowed: string[]) {
  if (!allowed.includes(userRole))
    throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав');
}
```

---

### GROUP: Activities — Ежедневные активности

#### `GET /api/activities/[date]`

**Файл:** `app/api/activities/[date]/route.ts`
**Описание:** Получить активности за дату (YYYY-MM-DD). Если записи нет — вернуть заготовку
с данными Манго (если синхронизировались). Manager получает только свои данные.
Head/admin передают `?manager_id=uuid` для чужих данных.
**Авторизация:** Любая роль.

**Query params:** `manager_id` (UUID, optional — только для head/admin)

**Ответ 200 (запись найдена):**
```json
{
  "data": {
    "id": "b1c2d3e4-1111-2222-3333-000000000001",
    "manager_id": "a1b2c3d4-0000-0000-0000-000000000001",
    "activity_date": "2026-05-22",
    "mango_calls_count": 11,
    "mango_calls_source": "mango_api",
    "hh_calls_count": 7,
    "hh_calls_source": "hh_csv",
    "total_calls": 18,
    "interviews_count": 4,
    "offers_count": 1,
    "notes": "Два сильных кандидата на Backend Dev",
    "updated_at": "2026-05-22T18:45:00Z",
    "exists": true,
    "hh_prefilled": false
  }
}
```

**Ответ 200 (запись не существует — заготовка с Манго):**
```json
{
  "data": {
    "id": null,
    "manager_id": "a1b2c3d4-0000-0000-0000-000000000001",
    "activity_date": "2026-05-22",
    "calls_count": 17,
    "hh_calls_count": 0,
    "hh_calls_source": "pending",
    "interviews_count": 0,
    "offers_count": 0,
    "notes": null,
    "exists": false,
    "hh_prefilled": false
  }
}
```

**Ответ 400 (неверный формат даты):**
```json
{
  "error": {
    "code": "INVALID_DATE_FORMAT",
    "message": "Дата должна быть в формате YYYY-MM-DD"
  }
}
```

**Ответ 422 (дата из будущего):**
```json
{
  "error": {
    "code": "FUTURE_DATE_NOT_ALLOWED",
    "message": "Нельзя запрашивать активности за будущую дату"
  }
}
```

---

#### `POST /api/activities`

**Файл:** `app/api/activities/route.ts`
**Описание:** Создать или обновить активности за день (upsert по `manager_id + activity_date`).
Manager — только свои данные. Head/admin могут передать `manager_id` в теле.
**Авторизация:** Любая роль.

**Тело запроса:**
```json
{
  "activity_date": "2026-05-22",
  "mango_calls_count": 15,
  "mango_calls_source": "mango_api",
  "hh_calls_count": 0,
  "hh_calls_source": "pending",
  "interviews_count": 5,
  "offers_count": 2,
  "notes": "Финальное собеседование Senior PM"
}
```

**Ответ 200:**
```json
{
  "data": {
    "id": "b1c2d3e4-1111-2222-3333-000000000001",
    "manager_id": "a1b2c3d4-0000-0000-0000-000000000001",
    "activity_date": "2026-05-22",
    "calls_count": 31,
    "calls_source": "manual",
    "interviews_count": 5,
    "offers_count": 2,
    "notes": "Финальное собеседование Senior PM",
    "updated_at": "2026-05-22T19:10:00Z"
  }
}
```

**Ответ 422:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "calls_count: ожидается целое число от 0 до 999"
  }
}
```

**Zod-схема (`app/api/activities/schema.ts`):**
```typescript
import { z } from 'zod';

const getSevenDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const ActivityUpsertSchema = z.object({
  activity_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты: YYYY-MM-DD')
    .refine((d) => {
      const date = new Date(d);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return date >= getSevenDaysAgo() && date <= today;
    }, 'Можно вводить данные только за последние 7 дней'),
  // Звонки Манго: cron заполняет автоматически; если нет добавочного — null
  mango_calls_count:  z.number().int().min(0).max(999).nullable().optional(),
  mango_calls_source: z.enum(['mango_api', 'manual', 'pending']).default('pending'),
  // Звонки HH: из CSV, загружается вручную; если нет hh_manager_id — null
  hh_calls_count:     z.number().int().min(0).max(999).nullable().optional(),
  hh_calls_source:    z.enum(['hh_csv', 'manual', 'pending']).default('pending'),
  // Собеседования — только ручной ввод менеджера
  interviews_count:    z.number().int().min(0).max(999),
  offers_count:        z.number().int().min(0).max(999),
  notes:               z.string().max(1000).nullable().optional(),
  manager_id:          z.string().uuid().optional(), // head/admin only
});
```

---

### GROUP: Vacancies — Вакансии

#### `GET /api/vacancies`

**Файл:** `app/api/vacancies/route.ts`
**Описание:** Список вакансий с краткой воронкой. Manager видит только свои.
**Query params:** `status=active` (active|paused|closed|all, default=active), `manager_id` (UUID, head/admin only), `page=1`, `per_page=20`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "c1d2e3f4-0000-0000-0000-000000000003",
      "hh_vacancy_id": "98765432",
      "title": "Менеджер по продажам (Москва)",
      "department": "Отдел продаж",
      "manager": {
        "id": "a1b2c3d4-0000-0000-0000-000000000001",
        "full_name": "Иванова Мария"
      },
      "status": "active",
      "opened_at": "2026-04-01",
      "funnel_summary": {
        "responses": 120,
        "views": 87,
        "calls": 43,
        "interviews": 12,
        "offers": 3,
        "hired": 2
      },
      "last_hh_snapshot_at": "2026-05-22T14:00:00Z"
    }
  ],
  "meta": { "total": 24, "page": 1, "per_page": 20 }
}
```

---

#### `GET /api/vacancies/[id]/funnel`

**Файл:** `app/api/vacancies/[id]/funnel/route.ts`
**Описание:** Детальная воронка по вакансии с конверсией и трендом за 14 дней.
**Query params:** `period=week` (today|week|month|all, default=month)

**Ответ 200:**
```json
{
  "data": {
    "vacancy_id": "c1d2e3f4-0000-0000-0000-000000000003",
    "title": "Менеджер по продажам (Москва)",
    "period": "week",
    "funnel": {
      "responses":        { "count": 120, "conversion_next_pct": 72.5, "source": "hh_api" },
      "contacts_opened":  { "count":  87, "conversion_next_pct": 49.4, "source": "hh_api" },
      "invitations_sent": { "count":  43, "conversion_next_pct": 27.9, "source": "hh_api" },
      "calls":            { "count":  12, "conversion_next_pct": 41.7, "source": "hh_calls", "note": "по менеджеру, не по вакансии" },
      "interviews":       { "count":   5, "conversion_next_pct": 60.0, "source": "manual" },
      "hired":            { "count":   3, "conversion_next_pct": null,  "source": "google_sheets" }
    },
    "trend_14d": [
      { "date": "2026-05-09", "responses": 5, "calls": 3, "interviews": 1, "hired": 0 },
      { "date": "2026-05-12", "responses": 7, "calls": 4, "interviews": 2, "hired": 0 },
      { "date": "2026-05-13", "responses": 4, "calls": 2, "interviews": 0, "hired": 1 }
    ],
    "last_hh_snapshot_at": "2026-05-22T14:00:00Z"
  }
}
```

**Ответ 404:**
```json
{
  "error": {
    "code": "VACANCY_NOT_FOUND",
    "message": "Вакансия не найдена"
  }
}
```

---

### GROUP: Dashboard — Дашборды

#### `GET /api/dashboard/team`

**Файл:** `app/api/dashboard/team/route.ts`
**Описание:** Сводный дашборд команды. Для роли `executive` — без имён менеджеров.
**Авторизация:** head, admin, executive
**Query params:** `period=week` (today|week|month, default=week)

**Ответ 200 (head/admin):**
```json
{
  "data": {
    "period": "week",
    "staffing": {
      "current_pct": 78,
      "recorded_at": "2026-05-20T10:00:00Z",
      "comment": "Закрыли 2 позиции в логистике"
    },
    "team_totals": {
      "calls":            { "fact": 316, "plan": 375, "pct": 84.3 },
      "interviews":       { "fact": 58,  "plan": 75,  "pct": 77.3 },
      "hires":            { "fact": 9,   "plan": 15,  "pct": 60.0 },
      "active_vacancies": 21
    },
    "managers": [
      {
        "id": "a1b2c3d4-0000-0000-0000-000000000001",
        "full_name": "Иванова Мария",
        "calls":      { "fact": 73, "plan": 75, "pct": 97.3 },
        "interviews": { "fact": 14, "plan": 15, "pct": 93.3 },
        "hires":      { "fact": 3,  "plan": 3,  "pct": 100.0 },
        "active_vacancies": 6,
        "status": "on_track"
      },
      {
        "id": "a1b2c3d4-0000-0000-0000-000000000002",
        "full_name": "Петров Алексей",
        "calls":      { "fact": 39, "plan": 75, "pct": 52.0 },
        "interviews": { "fact": 8,  "plan": 15, "pct": 53.3 },
        "hires":      { "fact": 1,  "plan": 3,  "pct": 33.3 },
        "active_vacancies": 4,
        "status": "critical"
      }
    ]
  }
}
```

**Ответ 200 (executive — без имён):**
```json
{
  "data": {
    "period": "week",
    "staffing": { "current_pct": 78, "recorded_at": "2026-05-20T10:00:00Z", "comment": "Закрыли 2 позиции в логистике" },
    "team_totals": {
      "calls":            { "fact": 412, "plan": 500, "pct": 82.4 },
      "interviews":       { "fact": 67,  "plan": 75,  "pct": 89.3 },
      "hires":            { "fact": 8,   "plan": 12,  "pct": 66.7 },
      "active_vacancies": 18
    },
    "managers": null
  }
}
```

---

#### `GET /api/dashboard/manager`

**Файл:** `app/api/dashboard/manager/route.ts`
**Описание:** Личный дашборд менеджера: KPI vs план + разбивка по дням.
**Авторизация:** manager (свои). Head/admin: `?manager_id=uuid`.
**Query params:** `period=week` (today|week|month), `manager_id` (optional, head/admin)

**Ответ 200:**
```json
{
  "data": {
    "manager": {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "full_name": "Иванова Мария"
    },
    "period": "week",
    "kpi": {
      "calls":      { "fact": 97, "plan": 100, "pct": 97.0, "status": "on_track" },
      "interviews": { "fact": 15, "plan": 15,  "pct": 100.0, "status": "on_track" },
      "hires":      { "fact": 3,  "plan": 3,   "pct": 100.0, "status": "on_track" }
    },
    "active_vacancies_count": 5,
    "daily_breakdown": [
      { "date": "2026-05-19", "calls": 22, "interviews": 3, "offers": 1, "hh_calls_source": "hh_api" },
      { "date": "2026-05-20", "calls": 18, "interviews": 2, "offers": 0, "hh_calls_source": "hh_api" },
      { "date": "2026-05-21", "calls": 25, "interviews": 4, "offers": 1, "hh_calls_source": "manual" },
      { "date": "2026-05-22", "calls": 32, "interviews": 6, "offers": 2, "hh_calls_source": "hh_api" }
    ]
  }
}
```

---

### GROUP: Plans — Планы

#### `GET /api/plans/[manager_id]`

**Файл:** `app/api/plans/[manager_id]/route.ts`
**Описание:** Текущий активный план менеджера (последний WHERE effective_from <= today).
**Авторизация:** manager (только свой), head/admin (любой).

**Ответ 200:**
```json
{
  "data": {
    "id": "d1e2f3a4-0000-0000-0000-000000000004",
    "manager_id": "a1b2c3d4-0000-0000-0000-000000000002",
    "effective_from": "2026-05-01",
    "calls_per_day": 20,
    "interviews_per_day": 3,
    "vacancies_limit": 8,
    "hires_per_month": 4,
    "set_by": { "id": "a1b2c3d4-0000-0000-0000-000000000000", "full_name": "Директор HR" }
  }
}
```

**Ответ 404:**
```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "Активный план для данного менеджера не найден"
  }
}
```

---

#### `POST /api/plans`

**Файл:** `app/api/plans/route.ts`
**Описание:** Создать новый план (старый остаётся в истории).
**Авторизация:** head, admin

**Тело запроса:**
```json
{
  "manager_id": "a1b2c3d4-0000-0000-0000-000000000002",
  "effective_from": "2026-06-01",
  "calls_per_day": 25,
  "interviews_per_day": 4,
  "vacancies_limit": 10,
  "hires_per_month": 5
}
```

**Ответ 200:**
```json
{
  "data": {
    "id": "e1f2a3b4-0000-0000-0000-000000000005",
    "manager_id": "a1b2c3d4-0000-0000-0000-000000000002",
    "effective_from": "2026-06-01",
    "calls_per_day": 25,
    "interviews_per_day": 4,
    "vacancies_limit": 10,
    "hires_per_month": 5,
    "created_at": "2026-05-22T11:00:00Z"
  }
}
```

**Zod-схема:**
```typescript
export const PlanCreateSchema = z.object({
  manager_id:         z.string().uuid(),
  effective_from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат: YYYY-MM-DD'),
  calls_per_day:      z.number().int().min(0).max(200),
  interviews_per_day: z.number().int().min(0).max(50),
  vacancies_limit:    z.number().int().min(0).max(100),
  hires_per_month:    z.number().int().min(0).max(100),
});
```

---

### GROUP: Staffing — Укомплектованность

#### `GET /api/staffing`

**Файл:** `app/api/staffing/route.ts`
**Описание:** Текущий % + история последних 20 записей.
**Авторизация:** Любая роль.

**Ответ 200:**
```json
{
  "data": {
    "current": {
      "staffing_pct": 78,
      "comment": "Закрыли 2 позиции в логистике",
      "recorded_by": { "id": "...", "full_name": "Директор HR" },
      "recorded_at": "2026-05-20T10:00:00Z"
    },
    "history": [
      { "staffing_pct": 78, "comment": "Закрыли 2 позиции в логистике", "recorded_by": { "full_name": "Директор HR" }, "recorded_at": "2026-05-20T10:00:00Z" },
      { "staffing_pct": 74, "comment": "Уволился тимлид разработки",    "recorded_by": { "full_name": "Директор HR" }, "recorded_at": "2026-05-10T09:00:00Z" }
    ]
  }
}
```

---

#### `POST /api/staffing`

**Файл:** `app/api/staffing/route.ts` (метод POST)
**Авторизация:** head, admin

**Тело:**
```json
{ "staffing_pct": 81, "comment": "Закрыли позицию тимлида разработки" }
```

**Zod-схема:**
```typescript
export const StaffingCreateSchema = z.object({
  staffing_pct: z.number().int().min(0).max(100),
  comment: z.string().max(500).nullable().optional(),
});
```

**Ответ 200:**
```json
{
  "data": {
    "id": "f1a2b3c4-0000-0000-0000-000000000010",
    "staffing_pct": 81,
    "comment": "Закрыли позицию тимлида разработки",
    "recorded_by": { "id": "...", "full_name": "Директор HR" },
    "recorded_at": "2026-05-22T11:00:00Z"
  }
}
```

---

### GROUP: Sync — Синхронизации

#### `POST /api/sync/sheets`

**Файл:** `app/api/sync/sheets/route.ts`
**Описание:** Ручной запуск синхронизации Google Sheets.
Читает строки где «Статус» = «закрыта» AND «Дата закрытия» непустая.
Блокирует повторный запуск если `sync_logs` содержит `status='running' AND source='sheets'`.
**Авторизация:** head, admin
**Тело:** `{}` (пустое)

**Ответ 200:**
```json
{
  "data": {
    "sync_log_id": "f1a2b3c4-0000-0000-0000-000000000006",
    "status": "ok",
    "rows_read": 120,
    "rows_matched_closed": 18,
    "vacancies_updated": 18,
    "hired_upserted": 18,
    "unmatched_vacancies": 2,
    "started_at": "2026-05-22T11:05:00Z",
    "finished_at": "2026-05-22T11:05:04Z"
  }
}
```

**Ответ 409 (уже запущена):**
```json
{
  "error": {
    "code": "SYNC_ALREADY_RUNNING",
    "message": "Синхронизация Google Sheets уже выполняется. Подождите завершения."
  }
}
```

**Ответ 502 (нет доступа к Sheets):**
```json
{
  "error": {
    "code": "SHEETS_AUTH_ERROR",
    "message": "Ошибка доступа к Google Sheets. Проверьте service account в настройках интеграций."
  }
}
```

---

#### `POST /api/sync/hh/upload`

**Файл:** `app/api/sync/hh/upload/route.ts`
**Описание:** Загрузка CSV-файлов из раздела «Аналитика подбора» HH.ru.
Принимает multipart/form-data с файлом и типом отчёта.
Парсит CSV (кодировка windows-1251 → UTF-8), сопоставляет имена менеджеров с `user_profiles`
через `hr_manager_syncs.sheet_full_name`, делает upsert в `hh_manager_stats`.
**Авторизация:** head, admin

**Тело запроса:** `multipart/form-data`
- `file` — CSV-файл (скачанный из HH)
- `report_type` — `calls` | `politeness_managers` | `politeness_company`
- `stat_date` — дата отчёта в формате `YYYY-MM-DD`

**Ответ 200:**
```json
{
  "data": {
    "report_type": "politeness_managers",
    "stat_date": "2026-05-22",
    "rows_parsed": 5,
    "rows_matched": 5,
    "rows_matched_exact": 3,
    "rows_matched_fuzzy": 2,
    "fuzzy_matches": [
      { "hh_name": "Иванова М.", "matched_to": "Иванова Мария", "score": 0.82 },
      { "hh_name": "Петров А.",  "matched_to": "Петров Алексей", "score": 0.78 }
    ],
    "rows_skipped": 3,
    "skipped_names": ["Козлова А.", "Воронов К.", "Иванов П."],
    "skip_reason": "Не найдены в листе 'HR менеджеры' Google Sheets — не наши менеджеры" 
  }
}
```

**Ответ 200 (есть несопоставленные менеджеры):**
```json
{
  "data": {
    "report_type": "calls",
    "stat_date": "2026-05-22",
    "rows_parsed": 6,
    "rows_matched": 5,
    "rows_skipped": 1,
    "skipped_names": ["Сидоров Иван"],
    "skip_reason": "Не найден в листе 'HR менеджеры' Google Sheets" 
  }
}
```

**Ответ 422 (неверный формат файла):**
```json
{
  "error": {
    "code": "INVALID_CSV_FORMAT",
    "message": "Файл не соответствует формату отчёта 'calls'. Ожидаемые колонки: Менеджер, Кол-во звонков, Дата"
  }
}
```

**Zod-схема:**
```typescript
export const HHUploadSchema = z.object({
  report_type: z.enum(['calls', 'politeness_managers', 'politeness_company']),
  stat_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

**Логика парсинга CSV (серверная, `lib/hh-csv-parser.ts`):**
```typescript
// Ожидаемые колонки по типу отчёта:
const EXPECTED_COLUMNS = {
  calls: ['Менеджер', 'Количество звонков'],
  politeness_managers: ['Менеджер', 'Индекс вежливости', 'Получено откликов',
                         'Отмечено просмотренными', 'Отправлено ответов', 'Среднее время ответа'],
  politeness_company:  ['Индекс вежливости', 'Получено откликов',
                         'Отмечено просмотренными', 'Отправлено ответов'],
};

// Декодирование windows-1251:
import iconv from 'iconv-lite'; // npm install iconv-lite
const decoded = iconv.decode(Buffer.from(fileBuffer), 'win1251');
```

---

#### `GET /api/stats/politeness`

**Файл:** `app/api/stats/politeness/route.ts`
**Описание:** Индекс вежливости компании и по каждому менеджеру за дату/период.
**Авторизация:** head, admin (manager — только свой)
**Query params:** `date=2026-05-22` (конкретная дата) или `period=month` (last N дней, default=30)

**Ответ 200:**
```json
{
  "data": {
    "period": "2026-05-01 — 2026-05-22",
    "company": {
      "politeness_index": 84.5,
      "responses_received": 312,
      "responses_viewed": 298,
      "responses_answered": 264,
      "avg_response_hours": 6.2,
      "trend": "up",
      "last_updated": "2026-05-22"
    },
    "managers": [
      {
        "manager_id": "a1b2c3d4-0000-0000-0000-000000000001",
        "full_name": "Иванова Мария",
        "politeness_index": 92.0,
        "hh_calls_count": 87,
        "responses_received": 64,
        "responses_viewed": 62,
        "responses_answered": 59,
        "avg_response_hours": 3.8,
        "trend": "up"
      },
      {
        "manager_id": "a1b2c3d4-0000-0000-0000-000000000002",
        "full_name": "Петров Алексей",
        "politeness_index": 71.0,
        "hh_calls_count": 43,
        "responses_received": 48,
        "responses_viewed": 40,
        "responses_answered": 34,
        "avg_response_hours": 14.5,
        "trend": "down"
      }
    ]
  }
}
```

---

#### `POST /api/sync/hh`

**Файл:** `app/api/sync/hh/route.ts`
**Описание:** Ручной on-demand запуск синхронизации HH.ru.
**Авторизация:** head, admin

**Ответ 200:**
```json
{
  "data": {
    "sync_log_id": "f1a2b3c4-0000-0000-0000-000000000007",
    "status": "ok",
    "records_total": 18,
    "records_updated": 18,
    "errors": []
  }
}
```

---

#### `GET /api/sync/logs`

**Файл:** `app/api/sync/logs/route.ts`
**Query params:** `source=all` (hh|sheets|all), `page=1`, `per_page=20`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "f1a2b3c4-0000-0000-0000-000000000006",
      "source": "sheets",
      "status": "ok",
      "records_total": 45,
      "records_updated": 7,
      "error_code": null,
      "triggered_by": "a1b2c3d4-0000-0000-0000-000000000000",
      "started_at": "2026-05-22T11:05:00Z",
      "finished_at": "2026-05-22T11:05:08Z"
    }
  ],
  "meta": { "total": 87, "page": 1, "per_page": 20 }
}
```

---

### GROUP: Bonuses — Бонусы HR

#### `GET /api/bonuses`

**Файл:** `app/api/bonuses/route.ts`
**Описание:** Список бонусов. Manager видит только свои. Head/admin — все.
**Query params:** `manager_id` (UUID, optional), `status=all` (pending|paid|all), `page=1`, `per_page=20`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "b1c2d3e4-0000-0000-0000-000000000010",
      "manager": { "id": "a1b2c3d4-0000-0000-0000-000000000001", "full_name": "Иванова Мария" },
      "vacancy": { "id": "c1d2e3f4-0000-0000-0000-000000000003", "title": "Менеджер по продажам (Москва)" },
      "vacancy_title_sheet": "Менеджер по продажам (Москва)",
      "bonus_amount_kopecks": 5000000,
      "bonus_amount_display": "50 000 ₽",
      "bonus_date": "2026-05-15",
      "status": "paid"
    },
    {
      "id": "b1c2d3e4-0000-0000-0000-000000000011",
      "manager": { "id": "a1b2c3d4-0000-0000-0000-000000000002", "full_name": "Петров Алексей" },
      "vacancy": null,
      "vacancy_title_sheet": "Старший менеджер отдела продаж",
      "bonus_amount_kopecks": 3500000,
      "bonus_amount_display": "35 000 ₽",
      "bonus_date": "2026-05-10",
      "status": "pending",
      "unmatched_note": "Вакансия не сопоставлена — привяжите вручную"
    }
  ],
  "meta": { "total": 14, "page": 1, "per_page": 20 }
}
```

---

#### `GET /api/bonuses/summary`

**Файл:** `app/api/bonuses/summary/route.ts`
**Описание:** Сводка бонусов по менеджерам за период (для дашборда эффективности).
**Query params:** `period=month` (week|month|quarter|year)

**Ответ 200:**
```json
{
  "data": [
    {
      "manager_id": "a1b2c3d4-0000-0000-0000-000000000001",
      "full_name": "Иванова Мария",
      "bonuses_count": 3,
      "total_pending_kopecks": 10000000,
      "total_paid_kopecks": 15000000,
      "total_display": "250 000 ₽",
      "last_bonus_date": "2026-05-15"
    }
  ]
}
```

---

#### `PATCH /api/bonuses/[id]/match`

**Файл:** `app/api/bonuses/[id]/match/route.ts`
**Описание:** Ручная привязка бонуса к вакансии (когда fuzzy-match не сработал).
**Авторизация:** head, admin

**Тело запроса:**
```json
{ "vacancy_id": "c1d2e3f4-0000-0000-0000-000000000003" }
```

**Ответ 200:**
```json
{
  "data": { "id": "b1c2d3e4-0000-0000-0000-000000000011", "vacancy_id": "c1d2e3f4-0000-0000-0000-000000000003", "matched_manually": true }
}
```

---

### GROUP: AI — Анализ и рекомендации

#### `GET /api/ai/insights`

**Файл:** `app/api/ai/insights/route.ts`
**Описание:** Список AI-инсайтов: аномалии, прогнозы, рекомендации, отчёты.
**Авторизация:** head, admin (manager — только свои аномалии/прогнозы)
**Query params:** `type=all` (anomaly|forecast|recommendation|weekly_report|all), `unread=false`, `page=1`, `per_page=20`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "ai01-0000-0000-0000-000000000001",
      "insight_type": "anomaly",
      "severity": "high",
      "period_start": "2026-05-16",
      "period_end": "2026-05-22",
      "manager": { "id": "a1b2c3d4-0000-0000-0000-000000000002", "full_name": "Петров Алексей" },
      "vacancy": null,
      "title": "Резкое падение звонков: Петров А. — 39/75 (52%) при норме ≥80%",
      "body_md": "## Аномалия: низкая активность

За неделю **19–25 мая** менеджер совершил **39 звонков** при плане **75**...",
      "meta_json": { "calls_fact": 39, "calls_plan": 75, "pct": 52, "prev_week_pct": 89 },
      "is_read": false,
      "created_at": "2026-05-22T21:00:00Z"
    },
    {
      "id": "ai01-0000-0000-0000-000000000002",
      "insight_type": "forecast",
      "severity": null,
      "period_start": "2026-05-01",
      "period_end": "2026-05-31",
      "manager": { "id": "a1b2c3d4-0000-0000-0000-000000000001", "full_name": "Иванова Мария" },
      "vacancy": null,
      "title": "Прогноз: Иванова М. закроет месяц на 94% плана при текущем темпе",
      "body_md": "## Прогноз выполнения плана

По состоянию на **22 мая** (16 из 22 рабочих дней)...",
      "meta_json": { "hires_fact": 11, "hires_plan": 15, "days_left": 6, "forecast_pct": 94 },
      "is_read": true,
      "created_at": "2026-05-22T21:00:00Z"
    }
  ],
  "meta": { "total": 8, "unread": 3, "page": 1, "per_page": 20 }
}
```

---

#### `POST /api/ai/insights/generate`

**Файл:** `app/api/ai/insights/generate/route.ts`
**Описание:** Запустить генерацию AI-инсайтов on-demand (руководитель нажимает «Обновить анализ»).
Генерирует: аномалии по всем менеджерам + прогнозы + рекомендации по проблемным вакансиям.
**Авторизация:** head, admin

**Тело запроса:** `{}` (пустое, или `{ "manager_id": "uuid" }` для анализа одного менеджера)

**Ответ 200:**
```json
{
  "data": {
    "anomalies_generated": 2,
    "forecasts_generated": 5,
    "recommendations_generated": 3,
    "tokens_used": 4820,
    "duration_ms": 3200
  }
}
```

**Ответ 429 (слишком частый запрос):**
```json
{
  "error": {
    "code": "AI_RATE_LIMIT",
    "message": "Следующий on-demand анализ доступен через 2 часа. Автоматический — каждую пятницу в 20:00."
  }
}
```

---

#### `GET /api/ai/report/[week]`

**Файл:** `app/api/ai/report/[week]/route.ts`
**Описание:** Получить еженедельный AI-отчёт по номеру недели (ISO, например `2026-W21`).
**Авторизация:** head, admin

**Ответ 200:**
```json
{
  "data": {
    "id": "ai01-0000-0000-0000-000000000010",
    "week": "2026-W21",
    "period": "19–25 мая 2026",
    "title": "Еженедельный отчёт HR-отдела: неделя 19–25 мая",
    "body_md": "## Итоги недели\n\n**Звонки:** 316/375 (84%) — жёлтая зона...",
    "meta_json": {
      "top_manager": { "name": "Иванова М.", "calls_pct": 97 },
      "bottom_manager": { "name": "Петров А.", "calls_pct": 52 },
      "anomalies_count": 2,
      "vacancies_at_risk": ["Менеджер по продажам (Москва)", "Тимлид разработки"]
    },
    "tokens_used": 2140,
    "created_at": "2026-05-22T20:05:00Z"
  }
}
```

**Ответ 404:**
```json
{ "error": { "code": "REPORT_NOT_FOUND", "message": "Отчёт за неделю 2026-W21 ещё не сгенерирован" } }
```

---

#### `PATCH /api/ai/insights/[id]/read`

**Файл:** `app/api/ai/insights/[id]/read/route.ts`
**Описание:** Пометить инсайт как прочитанный.
**Авторизация:** head, admin

**Ответ 200:** `{ "data": { "id": "...", "is_read": true } }`

---

### GROUP: Logs — Журналы

#### `GET /api/admin/audit-logs`

**Файл:** `app/api/admin/audit-logs/route.ts`
**Авторизация:** только `admin`
**Query params:** `table_name=` (all / vacancies / user_profiles / manager_plans / ...), `record_id=` (UUID), `user_id=`, `action=` (INSERT/UPDATE/DELETE/all), `date_from=`, `date_to=`, `page=1`, `per_page=50`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "a0b1c2d3-0000-0000-0000-000000000001",
      "user": { "id": "...", "full_name": "Директор HR", "role": "head" },
      "table_name": "manager_plans",
      "record_id": "d1e2f3a4-0000-0000-0000-000000000004",
      "action": "INSERT",
      "old_values": null,
      "new_values": {
        "calls_per_day": 20,
        "interviews_per_day": 5,
        "hires_per_month": 15,
        "effective_from": "2026-06-01"
      },
      "created_at": "2026-05-22T11:00:00Z"
    },
    {
      "id": "a0b1c2d3-0000-0000-0000-000000000002",
      "user": { "id": "...", "full_name": "Иванова Мария", "role": "manager" },
      "table_name": "vacancies",
      "record_id": "c1d2e3f4-0000-0000-0000-000000000003",
      "action": "UPDATE",
      "old_values": { "status": "active" },
      "new_values": { "status": "paused" },
      "created_at": "2026-05-22T14:30:00Z"
    }
  ],
  "meta": { "total": 342, "page": 1, "per_page": 50 }
}
```

---

#### `GET /api/admin/error-logs`

**Файл:** `app/api/admin/error-logs/route.ts`
**Авторизация:** только `admin`
**Query params:** `source=all`, `severity=all` (warning/error/critical/all), `resolved=false`, `date_from=`, `date_to=`, `page=1`, `per_page=50`

**Ответ 200:**
```json
{
  "data": [
    {
      "id": "e1f2a3b4-0000-0000-0000-000000000005",
      "source": "cron_mango",
      "severity": "error",
      "error_code": "MANGO_TIMEOUT",
      "message": "Request timeout after 10000ms for extension=101",
      "stack_trace": "Error: AbortError
  at fetchMango (sync-mango.ts:48)...",
      "context": { "manager_id": "a1b2...", "mango_extension": "101", "date": "2026-05-22" },
      "user_id": null,
      "http_method": null,
      "http_path": null,
      "http_status": null,
      "resolved": false,
      "created_at": "2026-05-22T20:01:23Z"
    },
    {
      "id": "e1f2a3b4-0000-0000-0000-000000000006",
      "source": "api",
      "severity": "error",
      "error_code": "VALIDATION_ERROR",
      "message": "calls_per_day: ожидается целое число от 0 до 200",
      "stack_trace": null,
      "context": { "body": { "calls_per_day": -5 } },
      "user_id": "a1b2c3d4-0000-0000-0000-000000000001",
      "http_method": "POST",
      "http_path": "/api/plans",
      "http_status": 422,
      "resolved": true,
      "resolved_at": "2026-05-22T15:00:00Z",
      "created_at": "2026-05-22T14:55:00Z"
    }
  ],
  "meta": { "total": 47, "unresolved": 12, "page": 1, "per_page": 50 }
}
```

---

#### `PATCH /api/admin/error-logs/[id]/resolve`

**Файл:** `app/api/admin/error-logs/[id]/resolve/route.ts`
**Описание:** Пометить ошибку как изученную/исправленную.
**Авторизация:** только `admin`

**Тело:** `{}` (пустое)

**Ответ 200:**
```json
{ "data": { "id": "...", "resolved": true, "resolved_by": "...", "resolved_at": "2026-05-22T16:00:00Z" } }
```

---

### GROUP: Admin — Администрирование

#### `POST /api/admin/users`

**Файл:** `app/api/admin/users/route.ts`
**Описание:** Создать нового пользователя через Supabase Auth invite. Профиль создаётся автоматически через trigger `handle_new_user`.
**Авторизация:** только `admin`

**Тело запроса:**
```json
{
  "email": "petrov@company.ru",
  "full_name": "Петров Алексей",
  "role": "manager",
  "subdivision": "Отдел продаж"
}
```

**Ответ 200:**
```json
{
  "data": {
    "user_id": "a1b2c3d4-0000-0000-0000-000000000002",
    "email": "petrov@company.ru",
    "full_name": "Петров Алексей",
    "role": "manager",
    "invite_sent": true
  }
}
```

**Ответ 409 (email уже существует):**
```json
{ "error": { "code": "EMAIL_ALREADY_EXISTS", "message": "Пользователь с таким email уже зарегистрирован" } }
```

**Zod-схема:**
```typescript
export const AdminUserCreateSchema = z.object({
  email:           z.string().email('Некорректный email'),
  full_name:       z.string().min(2).max(100),
  role:            z.enum(['manager', 'head', 'executive', 'admin']),
  subdivision: z.string().max(100).optional(),
});
```

---

#### `PATCH /api/admin/users/[id]`

**Файл:** `app/api/admin/users/[id]/route.ts`
**Описание:** Обновить роль, подразделение или деактивировать пользователя.
**Авторизация:** только `admin`

**Тело запроса:**
```json
{
  "full_name": "Петров Алексей Сергеевич",
  "role": "head",
  "subdivision": "HR отдел",
  "is_active": true
}
```

**Ответ 200:**
```json
{
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000002",
    "full_name": "Петров Алексей Сергеевич",
    "role": "head",
    "subdivision": "HR отдел",
    "is_active": true,
    "updated_at": "2026-05-22T15:00:00Z"
  }
}
```

---

#### `POST /api/admin/integrations/sheets/test`

**Файл:** `app/api/admin/integrations/sheets/test/route.ts`
**Описание:** Проверить доступ к Google Sheets — читает первую строку (заголовки) таблицы через service account.
**Авторизация:** только `admin`

**Ответ 200 (доступ есть):**
```json
{
  "data": {
    "ok": true,
    "sheet_title": "Вакансии",
    "total_rows": 247,
    "headers_found": ["Название", "Статус", "Дата открытия", "Дата закрытия", "Менеджер"],
    "response_ms": 210
  }
}
```

**Ответ 200 (нет доступа):**
```json
{
  "data": {
    "ok": false,
    "error": "The caller does not have permission",
    "hint": "Добавьте service account email как читателя в настройках доступа к таблице"
  }
}
```

---

## БЛОК 4: UI/UX

**Цветовая схема:** нейтральная, Tailwind slate/gray. Никакого кастомного бренда.
**Иконки:** Lucide React (`lucide-react`). Указаны конкретные иконки для каждого элемента.
**Компоненты:** shadcn/ui (импорт из `@/components/ui/`).
**Toast:** библиотека `sonner` (`toast.success()`, `toast.error()`).

### Глобальные Layout-обёртки

**`app/(auth)/layout.tsx`** — без sidebar, контент по центру (используется для `/login`).

**`app/(app)/layout.tsx`** — с sidebar 240px фиксированной ширины.

**Sidebar (`components/Sidebar.tsx`):**
- Логотип: текст «HR Control Tower», шрифт `font-semibold text-lg`
- Навигация (условный рендер по роли):
  - `manager`: `LayoutDashboard` «Мой кабинет» → `/cabinet`; `TrendingUp` «Мои KPI» → `/dashboard/manager`; `Briefcase` «Мои вакансии» → `/vacancies`
  - `head`/`admin`: + `Users` «Команда» → `/dashboard`; `Target` «Планы» → `/plan`; `Building2` «Укомплектованность» → `/staffing`; `RefreshCw` «Синхронизация» → `/sync`
  - `admin`: + `UserCog` «Пользователи» → `/admin/users`; `KeyRound` «Интеграции» → `/admin/integrations`
  - `executive`: `BarChart2` «Дашборд» → `/dashboard`; `Building2` «Укомплектованность» → `/staffing`
- Нижний блок: инициалы в `Avatar`, `full_name`, `role`, кнопка `LogOut` «Выйти»

---

### Экран: Вход `/login`

**Layout:** `(auth)/layout` — полноэкранный центр

**Компоненты:**
- `Card` шириной 400px: `CardHeader` «Войти в HR Control Tower», `CardContent` — форма
- `Label` + `Input` type=email, placeholder «ivanova@company.ru», иконка `Mail` слева
- `Label` + `Input` type=password, placeholder «••••••••», иконка `Lock` слева
- `Button` «Войти» full-width, variant=default, иконка `LogIn`
- `Alert` variant=destructive с иконкой `AlertCircle` — ошибка авторизации (скрыт по умолчанию)

**Состояния:**
- **Loading:** `Button` disabled, внутри `Loader2 animate-spin` + «Входим…»
- **Error:** `Alert` под кнопкой: «Неверный email или пароль»

**Действия:**
1. Submit (кнопка или Enter в поле password) → `supabase.auth.signInWithPassword()`:
   - `manager` → redirect `/cabinet`
   - `head`/`admin`/`executive` → redirect `/dashboard`
2. Ошибка авторизации → `Alert` появляется, кнопка снова активна

**Responsive:** карточка full-width на mobile (< 640px), padding 16px

---

### Экран: Личный кабинет менеджера `/cabinet`

**Layout:** `(app)/layout` с sidebar

**Компоненты:**
- **KPI-панель** `Card` над формой — 3 `Badge` в ряд (план из `manager_plans`):
  - `Phone` «Звонки 13/15» — зелёный (`bg-green-100 text-green-800`) если ≥90% плана (≥13)
  - `Users` «Собеседования 4/5» — жёлтый (`bg-yellow-100 text-yellow-800`) если 70–89% (3–4)
  - `FileCheck` «Офферы 1» — нейтральный серый (нет дневного плана по офферам, только факт)
  - Tooltip на badge звонков: «Манго: {mango} + HH: {hh} = {total}»
- **`MyBonusCard`** между KPI и формой — карточка «Мой бонус за месяц»:
  - Источник: `GET /api/bonuses` (без параметров → текущий месяц; manager-роль на стороне API форсится в свой `auth.uid()`).
  - `total > 0` → крупная зелёная сумма (формат «8 000 ₽»).
  - `total = 0` и есть hires без тарифа → серым «Тариф не настроен» + tooltip про fuzzy threshold.
  - `total = 0` и hires нет → серым «0 ₽».
  - Подпись курсивом: «за {Месяц YYYY}» (русское название месяца с заглавной).
- **DatePicker** — `Popover` + `Calendar` (shadcn):
  - Значение по умолчанию = сегодня
  - Даты из будущего: prop `disabled={(date) => date > new Date()}`
  - При смене даты → `GET /api/activities/[date]` → форма перезаполняется
- **Форма активностей** `Card`:
  - **Блок «Звонки» — итого и разбивка по источникам:**
    - `Label` «Звонки за день» — крупное число = `(mango_calls_count ?? 0) + (hh_calls_count ?? 0)`
    - Под числом — две строки источников (показывается только если источник активен):
      - `Zap` «Манго: **{mango_calls_count}**» + `Badge` «Манго API» (зелёный если mango_api, жёлтый если manual, серый если pending/null)
      - `Globe` «HH.ru: **{hh_calls_count}**» + `Badge` «HH CSV» (аналогично)
    - Если у менеджера нет `mango_extension` → строка Манго скрыта
    - Если у менеджера нет `hh_manager_id` → строка HH скрыта
    - `Input` type=number «Скорректировать вручную» — появляется рядом с источником если он в статусе `pending`
  - **`Label` + `Input` type=number «Собеседования»**, иконка `Users`
    - Под полем: `text-xs text-muted-foreground` «Введите вручную — сколько было сегодня»
  - **`Label` + `Input` type=number «Офферы»**, иконка `FileCheck`
  - **`Label` + `Textarea` «Заметки»**, 4 строки, placeholder «Что важного произошло сегодня?»
  - `Button` «Сохранить», variant=default, иконка `Save`
- **`Alert` звонки не получены** (условный рендер — оба источника в `pending` и оба активны):
  - variant=warning, иконка `AlertTriangle`: «Данные о звонках ещё не получены (Манго синхронизируется в 20:00, HH — после загрузки CSV). Введите вручную.»
  - Если только один источник pending — предупреждение только по нему

**Состояния:**
- **Loading (смена даты):** `Skeleton` — 3 блока 80×32px (KPI) + 4 поля-Skeleton в Card
- **Empty (новая дата, HH не синхронизировался):** форма с нулями + Alert HH
- **Error (сохранение):** `toast.error('Ошибка сохранения. Попробуйте ещё раз')`

**Действия:**
1. Смена даты в DatePicker → `GET /api/activities/[date]` → форма перезаполняется без перезагрузки
2. «Сохранить» → `POST /api/activities` → `toast.success('Данные за [дата] сохранены')` → KPI-панель пересчитывается

**Responsive:**
- Desktop: sidebar 240px + основной контент
- Mobile (< 768px): sidebar → `Sheet` (открывается по иконке `Menu` в header); форма full-width

---

### Экран: Сводный дашборд отдела `/dashboard`

**Назначение:** Верхний уровень — состояние всего HR-отдела одним взглядом.
**Layout:** `(app)/layout` с sidebar
**Доступ:** head, executive, admin

**Структура страницы (сверху вниз):**

**Секция 1 — «Отдел» (глобальные показатели):**
- **Блок укомплектованности** `Card` full-width:
  - `text-6xl font-bold` — «78%», цвет: `text-green-600` ≥80%, `text-yellow-600` 60–79%, `text-red-600` <60%
  - Подпись: «Обновлено 20.05.2026 · Закрыли 2 позиции в логистике»
  - `Button` иконка `Pencil` «Обновить» (только head/admin) → `Dialog`
- **`Tabs`** «Сегодня / Неделя / Месяц» — управляет периодом всей страницы
- **5 KPI-карточек** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4`:
  1. `Briefcase` «Активных вакансий» — счётчик без плана и без даты (`vacancies WHERE status='active'`).
  2. `Phone` «Звонки» — факт за выбранный период / план × workdays + `Progress`.
  3. `Users` «Собеседования» — то же.
  4. `UserCheck` «Выведено» — **всегда за полный текущий календарный месяц** через `vacancies WHERE status='closed' AND closed_at ∈ month`, независимо от таб-селектора. План = `hires_per_month` без масштабирования.
  5. `GraduationCap` «На стажировке» — счётчик без плана, только факт.
- **Воронка отдела** — горизонтальная мини-воронка (7 этапов, агрегат по всем вакансиям):
  ```
  [Отклики] → [Контакты] → [Приглашения] → [Звонки] → [Собеседования] → [Стажировка] → [Трудоустройство]
  ```
- **`Dialog` обновления укомплектованности**: Input 0–100 + Textarea комментарий + кнопка «Сохранить»

**Секция 2 — «Подразделения» (разрез по бизнес-юнитам):**
- Заголовок «По подразделениям» + `Button` «Подробнее →» → `/dashboard/divisions`
- `grid grid-cols-3 gap-4` — карточки по каждому подразделению:
  - Каждая `Card`: название подразделения + «Активных вакансий: 5» + «Выведено: 3/15» + `Progress`
  - Цвет прогресс-бара по % выполнения плана подразделения
  - Клик → `/dashboard/divisions?subdivision={name}`

**Секция 3 — «Команда» (только для head/admin):**
- Заголовок «Эффективность менеджеров» + `Button` «Подробнее →» → `/dashboard/efficiency`
- **Блок ИВ компании** `Card` (строка перед таблицей):
  - `Star` иконка, «Индекс вежливости компании: **84%**» — крупный текст
  - Под числом: «Ответили на 264 из 312 откликов · Среднее время ответа: 6.2 ч»
  - `Badge` trend: `TrendingUp` зелёный «+2.3 пп к прошлой неделе» или `TrendingDown` красный
  - Если данных нет: «CSV не загружен» серый Badge + `Button` «Загрузить» → `/sync`
- `Table` shadcn (компактная, топ-5 менеджеров):
  - Колонки: «Менеджер» | «Звонки %» | «Собеседования %» | «Выведено» | «ИВ» | «Статус»
  - «ИВ» — число с цветом: ≥85 зелёный, 70–84 жёлтый, <70 красный
  - Статус: `Badge` — «В плане» (зелёный), «Отставание» (жёлтый), «Критично» (красный)
  - Строка кликабельна → `Sheet` с детальной аналитикой менеджера
- Ссылка «Показать всех →» → `/dashboard/efficiency`

**Состояния:**
- **Loading:** `Skeleton` для каждой секции раздельно (загружаются параллельно)
- **Empty:** «Данных за выбранный период нет» под каждой секцией отдельно
- **Error:** `Alert` variant=destructive вверху: «Ошибка загрузки. Обновите страницу»

**Действия:**
1. Переключение `Tabs` → `GET /api/dashboard/team?period={p}` → все секции обновляются
2. Клик карточки подразделения → `/dashboard/divisions?subdivision={name}`
3. Клик строки менеджера → `Sheet` (аналитика по дням + вакансиям)
4. «Экспорт CSV» у таблицы команды

**Responsive:** Desktop: 4 KPI в ряд, 3 карточки подразделений. Tablet: 2+2. Mobile: 1 в ряд.

---

### Экран: Эффективность менеджеров `/dashboard/efficiency`

**Назначение:** Детальная аналитика по каждому менеджеру — KPI vs план + бонусы.
**Layout:** `(app)/layout` с sidebar
**Доступ:** head, admin (manager видит только свой `/dashboard/manager`)

**Структура страницы:**

**Панель фильтров** (sticky top):
- `Tabs` «Сегодня / Неделя / Месяц» (период)
- `Select` «Все менеджеры / {конкретный менеджер}»

**Блок ИВ компании** (sticky под фильтрами):
- `Card` горизонтальный: `Star` «ИВ компании: **84%**» | «Откликов: 312» | «Просмотрено: 298» | «Отвечено: 264» | «Среднее время ответа: 6.2 ч»
- Данные из `GET /api/stats/politeness?period={p}`
- Если CSV не загружен: `Alert` «Данные об индексе вежливости отсутствуют — загрузите CSV в разделе Синхронизация»

**Таблица менеджеров** `Table` — полная, не топ-5:
- Колонки: «Менеджер» | «Звонки (факт/план/%)» | «Собеседования (факт/план/%)» | «Выведено (факт/план/%)» | «На стажировке» | «ИВ» | «Бонусов ₽» | «Статус»
- «ИВ» — `Badge` с числом и цветом: ≥85 зелёный, 70–84 жёлтый, <70 красный; если нет данных — «—»
- При наведении на ИВ → `Tooltip`: «Ответил на {answered} из {received} откликов · Ср. время: {hours} ч»
- `Badge` статус: «В плане», «Отставание», «Критично»
- Строка кликабельна → `Sheet` с детальной аналитикой:
  - `SheetHeader`: «{full_name} — детальная аналитика»
  - `Tabs`: «По дням» | «По вакансиям» | «ИВ и звонки» | «Бонусы»
  - Вкладка «ИВ и звонки»:
    - `LineChart` (recharts) — динамика ИВ за период
    - Таблица по дням: Дата | Звонков | Откликов | Просмотрено | Отвечено | ИВ
  - Вкладка «Бонусы»: таблица бонусов менеджера с суммой и статусом

**Блок бонусов (аккордеон под таблицей):**
- `Collapsible` «Начисленные бонусы за период»:
  - Итого начислено: «250 000 ₽» / Из них выплачено: «150 000 ₽» / Ожидают выплаты: «100 000 ₽»
  - Ссылка «Все бонусы →» → `/bonuses`
- Данные из `GET /api/bonuses/summary?period={p}`

**Состояния:**
- **Loading:** `Skeleton` таблица 5 строк
- **Empty:** «Нет активностей за выбранный период»
- **Error:** `toast.error`

**Действия:**
1. Фильтр периода/менеджера → обновление таблицы
2. `Button` иконка `Download` «Экспорт CSV»
3. Клик строки → `Sheet`

---

### Экран: Аналитика по подразделениям `/dashboard/divisions`

**Назначение:** Воронка найма, сроки закрытия и % укомплектованности по каждому бизнес-юниту.
**Layout:** `(app)/layout` с sidebar
**Доступ:** head, executive, admin

**Структура страницы:**

**Панель фильтров:**
- `Select` «Все подразделения / {конкретное}»
- `Tabs` «Неделя / Месяц / Квартал»

**Таблица подразделений** `Table`:
- Колонки: «Подразделение» | «Активных вакансий» | «Закрыто за период» | «Средний срок закрытия» | «На стажировке» | «% выполнения плана»
- Строка кликабельна → разворачивается список вакансий подразделения (accordion)

**Детальная карточка подразделения** (при клике):
- Карточка подразделения раскрывается и показывает разбивку по городам
  (`vacancies.location`). Агрегат: количество активных и закрытых вакансий
  по каждому городу внутри подразделения. Формат строки:
  «{location} — {active} активных, {closed} закрытых». Если `location IS NULL` —
  отображается как «Не указан». «Закрытые» считаются за выбранный period
  (`status='closed' AND closed_at ∈ [from, to]`), активные — на текущий момент.
- Список вакансий `Table`: «Название» | «Менеджер» | «Статус» | «Дней открыта» | «Воронка мини»
- Мини-воронка в строке: `[R:120] → [C:87] → [I:43] → [Z:12] → [S:5] → [Стаж:2] → [Нанят:1]`
- `Badge` для вакансий с `days_to_close > 45`: `AlertTriangle` «Долго закрывается»

**KPI-блок подразделения:**
- Средний срок закрытия вакансии: «{avg_days_to_close} дней» (из `vacancies.days_to_close`)
- Воронка-агрегат: суммарные числа по всем вакансиям подразделения

**Состояния:**
- **Loading:** `Skeleton` таблица + карточки
- **Empty:** «Нет вакансий по выбранному подразделению»

---

### Экран: AI-инсайты `/ai`

**Назначение:** Центр AI-аналитики — аномалии, прогнозы, рекомендации по воронке, еженедельный отчёт.
**Layout:** `(app)/layout` с sidebar
**Доступ:** head, admin (manager видит только раздел «Мои прогнозы»)

**Структура страницы:**

**Панель управления** (top bar):
- `Button` variant=default иконка `Sparkles` «Обновить анализ» → `POST /api/ai/insights/generate` → spinner + toast
- `Badge` «Непрочитанных: 3» (красный) рядом с заголовком
- `Select` «Фильтр: Все / Аномалии / Прогнозы / Рекомендации / Отчёты»

**Секция «🔴 Аномалии» (insight_type = anomaly):**
- `Alert`-карточки, отсортированы по severity DESC:
  - `Card` с левой цветной полосой: красная (high), жёлтая (medium), серая (low)
  - Заголовок + `Badge` severity + имя менеджера + дата
  - 2–3 строки текста из `body_md` (truncated)
  - `Button` «Подробнее» → expandable секция с полным `body_md` (Markdown rendered)
  - `Button` `Check` «Прочитано» → `PATCH /api/ai/insights/[id]/read`
  - Числа из `meta_json`: мини-таблица «Факт: 39 | План: 75 | % прошлой недели: 89%»

**Секция «📈 Прогнозы» (insight_type = forecast):**
- `Card` на каждого менеджера:
  - Имя + прогнозный % + мини-`Progress` (зелёный ≥90%, жёлтый 70–89%, красный <70%)
  - «При текущем темпе закроет месяц на **94%** плана»
  - Числа: выведено 11/15, осталось 6 рабочих дней, нужно 4 вывода

**Секция «💡 Рекомендации по воронке» (insight_type = recommendation):**
- `Card` по каждой проблемной вакансии:
  - Название вакансии + конверсия «Контакт→Звонок: 23% (норма 41%)»
  - AI-рекомендация текстом: «Разрыв между открытыми контактами и звонками выше среднего...»
  - `Button` «Открыть вакансию» → `/vacancies/[id]`

**Секция «📋 Еженедельные отчёты» (insight_type = weekly_report):**
- Список последних 8 недель: дата + краткое summary + `Button` «Читать» → `/ai/report/[week]`
- Последний отчёт — развёрнут по умолчанию (full Markdown rendered)

**Состояния:**
- **Loading:** `Skeleton` карточки (4 шт. для каждой секции)
- **Empty (нет инсайтов):** «AI-анализ ещё не запускался. Нажмите "Обновить анализ".»
- **Error:** `toast.error('Ошибка генерации. Попробуйте позже.')`
- **Rate limit:** `Alert` «Следующий анализ доступен через {N} ч»

**Responsive:** Desktop: 2 колонки (аномалии слева, прогнозы справа). Mobile: 1 колонка.

**Добавить в sidebar:**
- `Sparkles` «AI-инсайты» → `/ai` (только head, admin) с `Badge` числа непрочитанных

---

### Экран: `/ai/report/[week]` — Еженедельный отчёт

**Layout:** `(app)/layout` с sidebar

**Компоненты:**
- `Breadcrumb`: «AI-инсайты / Отчёт за неделю {period}»
- Полный Markdown рендер `body_md` (библиотека `react-markdown`, `npm install react-markdown`)
- **Мета-панель** справа (sticky, desktop): «Топ менеджер: Иванова М. (97%)» | «Нуждается во внимании: Петров А.» | «Вакансий в риске: 2»
- `Button` `Printer` «Распечатать» — `window.print()`
- `Button` `Download` «Скачать PDF» → `GET /api/ai/report/[week]?format=pdf` (генерируется через puppeteer на Beget VPS)

---

### Экран: Бонусы `/bonuses`

**Назначение:** Таблица бонусов, начисленных менеджерам за закрытые вакансии
в текущем месяце. Источник — RPC `compute_manager_bonuses` (см. §5.3 / §5.6):
бонус = тариф из `bonus_rates`, fuzzy-совпавший с `hired_employees.position_name`
по `pg_trgm` (threshold 0.6). Статусов «начислен/выплачен» нет — `hr_bonuses`
не используется в новой модели.

**Layout:** `(app)/layout` с sidebar
**Доступ:** head/admin — все; manager — только свои (API форсит `p_manager_id = auth.uid()`).

**Компоненты:**
- **Подзаголовок** под `<h1>Бонусы</h1>` — «{Месяц YYYY}» (текущий календарный месяц, русское название с большой буквы, без «г.»).
- **Сводная карточка** (одна):
  - `Card` «Начислено за месяц» — `total_amount_display` из `/api/bonuses`. Сумма не включает строки без тарифа (API уже агрегирует только non-NULL `amount_kopecks`).
- **Фильтр** (только head/admin): `Select` «Все менеджеры / {ФИО}».
- **`Table`** бонусов:
  - Колонки: «Менеджер» | «Вакансия» | «Тариф» | «Сумма»
  - «Тариф» = `rate_position_name` (название тарифа из `bonus_rates`). Если fuzzy-матч не нашёл совпадения (similarity < 0.6) — курсивом «Тариф не задан» с tooltip про порог; строка остаётся в таблице, но в общую сумму не идёт.

**Состояния:**
- **Loading:** `Skeleton`
- **Empty:** «Бонусов за текущий месяц нет»

---

### Экран: Воронка по вакансии `/vacancies/[id]`

**Layout:** `(app)/layout` с sidebar

**Компоненты:**
- `Breadcrumb`: «Вакансии / Менеджер по продажам (Москва)»
- **Воронка** — горизонтальный ряд из 6 `Card`:
  ```
  [Отклики 120] →72%→ [Резюме 87] →49%→ [Звонки 43] →28%→ [Собеседования 12] →25%→ [Офферы 3] →67%→ [Найм 2]
  ```
  - Между блоками: иконка `ChevronRight` + текст конверсии `text-xs text-muted-foreground`
- **`Tabs`** период: «Сегодня / Неделя / Месяц / Всё время»
- **Карточка менеджера** `Card` — аватар (инициалы), имя, мини-KPI по вакансии
- **Тренд-график** `LineChart` (recharts, 14 точек) — отклики и звонки по дням
- **Метка обновления** справа вверху: `Clock` + «Данные актуальны на 14:32»
- **Срок закрытия** (только для закрытых вакансий): `Badge` variant=secondary `Timer` «Закрыта за 23 дня»
  - Для активных вакансий: `Badge` variant=outline `Timer` «Открыта 12 дней»
  - Вычисляется из `vacancies.days_to_close` (закрытые) или `CURRENT_DATE - opened_at` (активные)

**Состояния:**
- **Loading:** `Skeleton` для воронки (6 блоков 120×80px) + `Skeleton` для графика
- **Empty (нет данных HH):** в блоках откликов и резюме «—» + `Alert` «Синхронизация с HH не проводилась»; `Button` «Синхронизировать HH» (head/admin)
- **Error (404):** `Card` по центру: иконка `AlertCircle`, «Вакансия не найдена», `Button` `ArrowLeft` «К списку»

**Действия:**
1. Переключение `Tabs` → `GET /api/vacancies/[id]/funnel?period={p}` → воронка пересчитывается
2. «Синхронизировать HH» → `POST /api/sync/hh` → toast + обновление данных

---

### Экран: Настройка планов `/plan`

**Layout:** `(app)/layout` с sidebar

**Компоненты:**
- `Table` — строки: менеджеры; колонки: «Менеджер» | «Звонков/день» | «Собеседований/день» | «Лимит вакансий» | «Выводов/месяц» | «Действует с» | «Действия»
- Режим редактирования: клик иконки `Pencil` → ячейки становятся `Input` type=number inline
- `Button` «Сохранить» появляется только если есть несохранённые изменения
- `Button` variant=ghost иконка `History` → `Sheet` с историей планов менеджера

**Состояния:**
- **Loading:** `Skeleton` — 5 строк таблицы
- **Empty (нет менеджеров):** `Alert` «Добавьте менеджеров в Администрирование → Пользователи»
- **Error:** `toast.error('Ошибка сохранения плана')`

**Действия:**
1. Клик `Pencil` → inline-редактирование строки
2. «Сохранить» → `POST /api/plans` → toast → строка выходит из режима редактирования
3. «История» → `Sheet` с таблицей `manager_plans` по данному менеджеру

---

### Экран: Укомплектованность `/staffing`

**Layout:** `(app)/layout` с sidebar

**Компоненты:**
- Крупный `Card` — текущий %: `text-8xl font-bold` по центру
- Цвет: такой же как на дашборде (green/yellow/red)
- Подпись: «Обновлено {дата} · {comment}»
- `Button` «Обновить %» (только head/admin) → `Dialog` с формой
- `Table` история: «Дата» | «%» | «Комментарий» | «Кто обновил» (последние 20 записей)

**Состояния:**
- **Loading:** `Skeleton` 200×100px (число) + `Skeleton` таблица
- **Empty (нет ни одной записи):** «% укомплектованности ещё не установлен. Нажмите "Обновить".»
- **Error:** `toast.error('Ошибка сохранения')`

---

### Экран: Синхронизация `/sync`

**Layout:** `(app)/layout` с sidebar

**Компоненты:**

**Секция «Автоматические синхронизации»** (2 `Card` в ряд):
- **HH.ru API** `Card`: статус последнего cron-запуска (каждые 2ч), `Button` «Синхронизировать сейчас» → `POST /api/sync/hh`
- **Google Sheets** `Card`: статус последней синхронизации, `Button` «Синхронизировать» → `POST /api/sync/sheets`

**Секция «Загрузка отчётов HH»** (`Card` full-width):
- Заголовок «Загрузка CSV из HH.ru → Аналитика подбора»
- Под заголовком: серая инструкция в 2 строки:
  «1. Перейдите в hh.ru → Аналитика подбора → нужный отчёт → Скачать CSV»
  «2. Загрузите файл ниже — система распознает тип отчёта автоматически»
- `grid grid-cols-3 gap-4` — три зоны загрузки:
  - `Card` «Звонки менеджеров» — иконка `Phone`, `Input` type=file accept=.csv, DatePicker дата отчёта, `Button` «Загрузить»
  - `Card` «Индекс вежливости менеджеров» — иконка `Star`, аналогично
  - `Card` «Индекс вежливости компании» — иконка `Building2`, аналогично
- Каждая зона: после успешной загрузки → зелёный `Badge` «Загружено: 22.05.2026, 5 менеджеров»
- После успешной загрузки → `Card` с результатом:
  - Зелёный `Badge` «Точно сопоставлено: 3 менеджера»
  - Жёлтый `Badge` (если есть) «Через fuzzy: 2 — проверьте» + раскрывающаяся таблица:
    | Имя в HH | Сопоставлен с (Sheets) | Схожесть |
    |«Иванова М.» | «Иванова Мария» | 82% |
    | «Петров А.» | «Петров Алексей» | 78% |
    Руководитель видит пары — если совпадение неверное, исправляет имя в Sheets
  - Серый `Collapsible` «Пропущено 3 (не наши): Козлова А., Воронов К., Иванов П.»

**Журнал последних 20 синхронизаций** `Table`:
- Колонки: «Время» | «Источник» | «Тип» | «Статус» | «Записей» | «Ошибка»
- «Тип»: `Badge` — «HH API», «HH Звонки CSV», «HH ИВ менеджеров CSV», «HH ИВ компании CSV», «Google Sheets»

**Действие «Загрузить CSV»:**
1. Выбор файла + дата → `Button` «Загрузить» → `POST /api/sync/hh/upload` (multipart/form-data)
2. Spinner на кнопке
3. Success: зелёный Badge + запись в журнале
4. Error с несопоставленными: жёлтый Alert с именами

---

### Экран: Создание / редактирование вакансии `/vacancies/new` и `/vacancies/[id]/edit`

**Layout:** `(app)/layout` с sidebar
**Доступ:** только `head`, `admin`

**Компоненты:**
- `Card` с формой:
  - `Label` + `Input` id=`title` «Название вакансии», placeholder «Менеджер по продажам (Москва)», required
  - `Label` + `Input` id=`department` «Отдел», placeholder «Отдел продаж»
  - `Label` + `Select` «Ответственный менеджер» — список из `user_profiles WHERE role='manager' AND is_active=true`
  - `Label` + `Input` id=`hh_vacancy_id` «ID вакансии на HH.ru», placeholder «98765432», optional
    - Под полем: `text-xs text-muted-foreground` «Числовой ID из URL: hh.ru/vacancy/{id}»
  - `Label` + `Input` type=date id=`opened_at` «Дата открытия», default = сегодня
  - `Label` + `Select` id=`status` «Статус»: active / paused / draft / closed
  - `Button` «Сохранить», variant=default, иконка `Save`
  - `Button` «Отмена», variant=outline → redirect `/vacancies`

**Состояния:**
- **Loading (редактирование):** `Skeleton` полей формы пока данные загружаются
- **Error:** `toast.error('Ошибка сохранения вакансии')`
- **Success:** `toast.success('Вакансия сохранена')` → redirect `/vacancies/[id]`

**Валидация (клиент, до отправки):**
- `title`: обязательное, 2–200 символов
- `manager_id`: обязательное
- `hh_vacancy_id`: опциональное, только цифры `/^\d+$/`

---

### Экран: Управление пользователями `/admin/users`

**Layout:** `(app)/layout` с sidebar
**Доступ:** только `admin`

**Компоненты:**
- `Button` «Добавить пользователя» variant=default иконка `UserPlus` → `Dialog`
- `Table`:
  - Колонки: «Имя» | «Email» | «Роль» | «Подразделение» | «Статус» | «Действия»
  - «Статус»: `Badge` — зелёный «Активен» / серый «Деактивирован»
  - «Действия»: иконка `Pencil` (редактировать) + иконка `PowerOff` (деактивировать/активировать)

**`Dialog` создания пользователя:**
- `Input` type=email «Email»
- `Input` «Полное имя»
- `Select` «Роль» (manager / head / executive / admin)
- `Input` «Подразделение» placeholder «Отдел продаж»
- `Button` «Создать» → `POST /api/admin/users`:
  1. `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, role } })`
  2. Пользователь получает письмо для установки пароля
  3. Профиль создаётся через trigger `handle_new_user`

**Состояния:**
- **Loading:** `Skeleton` строки (6 шт.)
- **Empty:** «Пользователей нет. Нажмите "Добавить пользователя".»
- **Error:** `toast.error('Ошибка создания пользователя')`

---

### Экран: Журналы `/admin/logs`

**Назначение:** Просмотр audit trail (кто что менял) и error logs (что сломалось).
**Layout:** `(app)/layout` с sidebar
**Доступ:** только `admin`

**Структура страницы:**

**`Tabs`** «Ошибки» / «Аудит» — две независимые секции.

---

**Вкладка «Ошибки» (error_logs):**

- **Сводные Badge** в шапке: `AlertCircle` «Нерешённых: 12» (красный) | «За сегодня: 5» | «Critical: 2»
- **Фильтры** (строка): `Select` источник (all / cron_hh / cron_mango / cron_ai / api / ...) + `Select` серьёзность + `Switch` «Только нерешённые» + DateRange
- **`Table`**:
  - Колонки: «Время» | «Источник» | «Серьёзность» | «Код» | «Сообщение» | «Статус»
  - «Серьёзность»: `Badge` — красный critical, оранжевый error, жёлтый warning
  - «Статус»: `Badge` — красный «Открыта» / зелёный «Решена»
  - Строка кликабельна → `Sheet` с деталями:
    - Полный `message` + `stack_trace` в `<pre>` блоке (моноширинный шрифт)
    - `context` — форматированный JSON
    - Для source=`api`: HTTP метод + путь + статус
    - `Button` «Отметить решённой» → `PATCH /api/admin/error-logs/[id]/resolve`
- **`Button`** `Download` «Экспорт CSV» — выгрузка всех нерешённых

**Состояния:**
- **Loading:** `Skeleton` таблица 8 строк
- **Empty (нет ошибок):** `CheckCircle` зелёный «Ошибок нет — всё работает»
- **Много ошибок одного типа:** `Alert` variant=destructive «За последние 24ч: 47 ошибок MANGO_TIMEOUT — проверьте соединение с Манго API»

---

**Вкладка «Аудит» (audit_logs):**

- **Фильтры**: `Select` таблица (all / vacancies / manager_plans / ...) + `Select` действие (INSERT/UPDATE/DELETE/all) + `Input` UUID записи + DateRange
- **`Table`**:
  - Колонки: «Время» | «Пользователь» | «Таблица» | «Действие» | «Запись» | «Что изменилось»
  - «Действие»: `Badge` — зелёный INSERT, синий UPDATE, красный DELETE
  - «Что изменилось»: краткая сводка «status: active → paused» (из diff old/new)
  - Строка кликабельна → `Sheet` с полным diff:
    - Два столбца `old_values` / `new_values` — подсвечены различия (красный фон старое, зелёный фон новое)
- **`Button`** «Экспорт CSV»

**Responsive:** обе вкладки — таблица с горизонтальным скроллом на mobile

---

### Экран: Токены интеграций `/admin/integrations`

**Layout:** `(app)/layout` с sidebar
**Доступ:** только `admin`

**Компоненты:**
- **Карточка HH.ru** `Card`:
  - `Table` менеджеров: «Менеджер» | «Статус токена» | «Истекает» | «Действие»
  - Статус: `Badge` зелёный «Активен», жёлтый «Истекает < 3 дней», красный «Истёк»
  - `Button` «Переавторизовать» → OAuth flow HH.ru в новой вкладке

- **Карточка Google Sheets** `Card`:
  - `Input` «Spreadsheet ID», placeholder «1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms»
  - `Input` «Название листа», placeholder «Вакансии» (имя вкладки в файле)
  - `Textarea` «Service Account JSON Key» — замаскирован (показывает только email)
  - `Button` «Проверить доступ» → `POST /api/admin/integrations/sheets/test`
    - При успехе: зелёный `Alert` «Доступ есть. Строк: 247. Заголовки найдены.»
    - При ошибке: красный `Alert` «Нет доступа. Добавьте {email} как читателя в Google Sheets.»
  - `Button` «Сохранить»

---

## БЛОК 5: Business Logic

### 5.1. Аутентификация

**Вход (шаги):**
1. Пользователь вводит email + пароль на `/login`
2. Фронтенд: `supabase.auth.signInWithPassword({ email, password })`
3. Supabase возвращает JWT (access_token) + refresh_token
4. `@supabase/ssr` сохраняет токены в httpOnly cookies
5. `middleware.ts` на каждом запросе: `supabase.auth.getUser()` — если нет сессии → redirect `/login`
6. Просроченный access_token: `@supabase/ssr` автоматически рефрешит через refresh_token
7. Если refresh невалиден → `middleware.ts` редиректит на `/login`

**Роль** читается из `user_profiles.role` в каждом API-хендлере через `getAuthUser()`.

**Регистрация:** только через Supabase Dashboard или admin-интерфейс (`/admin/users`).
Самостоятельная регистрация: отключена (нет публичной формы регистрации).

**Восстановление пароля:**
1. На странице `/login` ссылка «Забыли пароль?» → `/forgot-password`
2. `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://hr.company.ru/auth/reset-password' })`
3. Пользователь кликает ссылку из письма → форма смены пароля на `/auth/reset-password`
4. `supabase.auth.updateUser({ password: newPassword })`

---

### 5.2. Правила валидации форм

**Форма ввода активностей:**

| Поле | Тип | Min | Max | Обязательное | Сообщение ошибки |
|------|-----|-----|-----|--------------|-----------------|
| `activity_date` | date | сегодня−7 дней | сегодня | да | «Можно вводить за последние 7 дней» |
| `calls_count` | integer | 0 | 999 | да | «Введите число от 0 до 999» |
| `calls_source` | enum | — | — | да | — |
| `interviews_count` | integer | 0 | 999 | да | «Введите число от 0 до 999» |
| `offers_count` | integer | 0 | 999 | да | «Введите число от 0 до 999» |
| `notes` | string | 0 | 1000 символов | нет | «Максимум 1000 символов» |

**Форма плана:**

| Поле | Min | Max | Ошибка |
|------|-----|-----|--------|
| `calls_per_day` | 0 | 200 | «От 0 до 200» |
| `interviews_per_day` | 0 | 50 | «От 0 до 50» |
| `vacancies_limit` | 0 | 100 | «От 0 до 100» |
| `hires_per_month` | 0 | 100 | «От 0 до 100» |

**Форма укомплектованности:**

| Поле | Min | Max | Ошибка |
|------|-----|-----|--------|
| `staffing_pct` | 0 | 100 | «Значение от 0 до 100» |
| `comment` | 0 | 500 | «Максимум 500 символов» |

---

### 5.3. Расчёт статуса менеджера

Выполняется на сервере в `/api/dashboard/team`:

```typescript
// Статус = по среднему % выполнения трёх KPI
function calcManagerStatus(
  callsPct: number,
  interviewsPct: number,
  hiresPct: number
): 'on_track' | 'behind' | 'critical' {
  const avg = (callsPct + interviewsPct + hiresPct) / 3;
  if (avg >= 90) return 'on_track';  // зелёный Badge
  if (avg >= 70) return 'behind';    // жёлтый Badge
  return 'critical';                  // красный Badge
}
```

**Расчёт плана за период:**
- `plan_calls = calls_per_day × workdays_in_period`
- `workdays_in_period` = кол-во дней Пн–Пт в выбранном периоде (суббота и воскресенье не считаются)
- `fact_calls = SUM(daily_activities.calls_count) WHERE manager_id AND activity_date IN [period_start, period_end]`

**Расчёт воронки по вакансии (7 этапов):**

```
Отклики → Открытые контакты → Приглашения → Звонки → Собеседования → Стажировка → Трудоустройство
```

| Этап | Источник данных | Привязка | Тип |
|------|----------------|----------|-----|
| `responses` | `vacancy_snapshots.responses_count` (HH API, последний snapshot) | По вакансии ✓ | Авто |
| `contacts_opened` | `vacancy_snapshots.contacts_opened` (HH API, прирост за период) | По вакансии ✓ | Авто |
| `invitations_sent` | `vacancy_snapshots.invitations_sent` (HH API, `counters.invitations`) | По вакансии ✓ | Авто |
| `calls` | `SUM(COALESCE(mango_calls_count,0) + COALESCE(hh_calls_count,0))` по менеджеру | По менеджеру ⚠️ | Манго cron + HH CSV |
| `interviews` | `SUM(daily_activities.interviews_count)` по менеджеру (ручной ввод) | По менеджеру ⚠️ | Ручной |
| `interns` | `COUNT(hired_employees WHERE vacancy_id=[id] AND status='probation')` | По вакансии ✓ | Sheets |
| `hired` | `COUNT(hired_employees WHERE vacancy_id=[id] AND status='hired')` | По вакансии ✓ | Sheets |

**Правило стажировки:**
- Кандидат со статусом «стажировка» в Sheets → `employment_type = 'intern'` **и** `status = 'probation'`
  (миграция `20260523160000_*`: status TEXT NOT NULL DEFAULT 'hired' CHECK IN ('hired', 'probation'))
- В воронке занимает этап **«Стажировка»** — между собеседованием и трудоустройством
- Вакансия НЕ закрывается: `vacancies.status` остаётся `active`/`paused`, `closed_at = NULL`
- Когда HR меняет статус в Sheets с «стажировка» на «закрыта» → следующая синхронизация
  (upsert по `sheet_row_id`) переводит ту же запись в `employment_type='employee'`, `status='hired'`
  и одновременно `vacancies.status='closed'`, `closed_at = M`
- В дашборде менеджера: счётчик «На стажировке: 3» отдельным KPI-блоком рядом с «Выведено»
  (без плана — только факт, промежуточный этап воронки)

⚠️ **Звонки и собеседования агрегируются по менеджеру, не по вакансии** — менеджер ведёт
несколько вакансий одновременно. Для оценки воронки конкретной вакансии
используем `responses → contacts_opened → invitations_sent` (точные данные HH).
Звонки/собеседования — для оценки активности менеджера.

**Расчёт срока закрытия вакансии:**
- `days_to_close = closed_at - opened_at` (вычисляемый столбец в `vacancies`, тип GENERATED ALWAYS AS STORED)
- Отображается на карточке вакансии: «Закрыта за 23 дня»
- В дашборде руководителя: средний `days_to_close` по закрытым за период (KPI отдела)
- Данные `opened_at` и `closed_at` берутся из Google Sheets (импорт) или вводятся вручную

**Расчёт звонков за день (серверная логика):**
```typescript
// totalCalls = Манго + HH (оба опциональны, зависит от того какой источник у менеджера)
// mango_calls_count: из vpbx/stats/request по from.extension (cron 20:00)
// hh_calls_count:    из CSV «Аналитика подбора → Менеджеры → Звонки» (ручная загрузка)
const totalCalls = (mango_calls_count ?? 0) + (hh_calls_count ?? 0);
// Пример: менеджер звонит только через Манго → mango=15, hh=null → total=15
// Пример: менеджер звонит только через HH    → mango=null, hh=8  → total=8
// Пример: смешанный                           → mango=11, hh=7   → total=18
```

**Выполнение плана по звонкам:**
- `plan_calls_day = manager_plans.calls_per_day` (дефолт: 15)
- `fact_calls_day = COALESCE(mango_calls_count, 0) + COALESCE(hh_calls_count, 0)` из `daily_activities`
- `plan_interviews_day = manager_plans.interviews_per_day` (дефолт: 5)
- `fact_interviews_day = daily_activities.interviews_count` (ручной ввод)
- `plan_hires_month = manager_plans.hires_per_month` (дефолт: 15 на весь отдел)
- `fact_hires_month = COUNT(hired_employees WHERE hired_date IN [месяц])`

---

### 5.4. Интеграция с HH.ru API

**Базовый URL:** `https://api.hh.ru`
**Аутентификация:** `Authorization: Bearer {hh_access_token}` (из `user_profiles.hh_access_token`)

**Используемые эндпоинты HH.ru:**
```
GET /vacancies/{vacancy_id}
  Ответ (нужные поля):
  {
    "name": "Менеджер по продажам",
    "status": { "id": "published" },
    "counters": {
      "responses": 120,      // всего откликов
      "views": 87,           // просмотров резюме
      "invitations": 43,     // отправлено приглашений
      "discards": 12         // отклонено
    }
  }
  → responses_count  = counters.responses
  → views_count      = counters.views
  → invitations_sent = counters.invitations

GET /negotiations?vacancy_id={vacancy_id}&status=active&per_page=0
  → contacts_opened за день = разница found между двумя последовательными snapshots.

GET /employers/{employer_id}/statistics/calls
  Используется для получения статистики встроенных звонков HH по рекрутёру.
  Параметры: date_from, date_to, manager_id (ID рекрутёра в системе HH работодателя)
  Ответ:
  {
    "calls": [
      {
        "manager_id": "12345",
        "calls_count": 18,
        "date": "2026-05-22"
      }
    ]
  }
  → hh_calls_count = calls[manager_id].calls_count за дату

  Примечание: Эндпоинт доступен для работодателей с подпиской HH, где включена
  функция встроенных звонков. manager_id в HH сопоставляется с user_profiles через
  поле hh_manager_id (добавить в user_profiles).
```

**Cron-скрипт `scripts/sync-hh.ts` (Beget VPS):**
```typescript
// Запускается pm2-cron: 0 8,10,12,14,16,18,20,22 * * 1-5
// (каждые 2 часа с 8:00 до 22:00, только в рабочие дни)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // bypasses RLS
);

async function syncHH() {
  // 1. Создать лог-запись
  const { data: log } = await supabase
    .from('sync_logs')
    .insert({ source: 'hh', status: 'running', triggered_by: 'cron' })
    .select().single();

  let totalUpdated = 0;
  const errors: string[] = [];

  try {
    // 2. Получить все активные вакансии с HH ID и токеном менеджера
    const { data: vacancies } = await supabase
      .from('vacancies')
      .select('id, hh_vacancy_id, manager_id, user_profiles(hh_access_token, hh_refresh_token, hh_token_expires_at)')
      .eq('status', 'active')
      .not('hh_vacancy_id', 'is', null);

    for (const vacancy of vacancies ?? []) {
      const token = (vacancy.user_profiles as any)?.hh_access_token;
      if (!token) continue;

      // 3. Проверить и обновить токен если истекает в ближайшие 24ч
      const expiresAt = new Date((vacancy.user_profiles as any)?.hh_token_expires_at);
      if (expiresAt < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
        const refreshed = await refreshHHToken(vacancy.manager_id, (vacancy.user_profiles as any)?.hh_refresh_token);
        if (!refreshed) {
          errors.push(`HH_TOKEN_EXPIRED for manager_id=${vacancy.manager_id}`);
          await notifyAdmin(`⚠️ Требуется переавторизация HH: manager_id=${vacancy.manager_id}`);
          continue;
        }
      }

      // 4. Запрос к HH API с retry
      const stats = await fetchWithRetry(
        `https://api.hh.ru/vacancies/${vacancy.hh_vacancy_id}`,
        { headers: { Authorization: `Bearer ${token}` } },
        3 // retries
      );

      if (!stats) {
        errors.push(`FETCH_FAILED for hh_vacancy_id=${vacancy.hh_vacancy_id}`);
        continue;
      }

      // 5. Если вакансия закрыта на HH — обновить статус в БД
      if (stats.status?.id === 'archived') {
        await supabase.from('vacancies').update({ status: 'closed' }).eq('id', vacancy.id);
      }

      // 6. Сохранить snapshot
      await supabase.from('vacancy_snapshots').insert({
        vacancy_id: vacancy.id,
        responses_count: stats.counters?.responses ?? 0,
        views_count: stats.counters?.views ?? 0,
        source: 'hh_api',
      });

      totalUpdated++;
    }

    // 7. Обновить лог
    await supabase.from('sync_logs').update({
      status: errors.length > 0 ? 'partial' : 'ok',
      records_total: vacancies?.length ?? 0,
      records_updated: totalUpdated,
      error_message: errors.length > 0 ? errors.join('; ') : null,
      finished_at: new Date().toISOString(),
    }).eq('id', log.id);

  } catch (err: any) {
    await supabase.from('sync_logs').update({
      status: 'error',
      error_code: 'UNEXPECTED_ERROR',
      error_message: err.message,
      finished_at: new Date().toISOString(),
    }).eq('id', log.id);
    await notifyAdmin(`❌ HH sync critical error: ${err.message}`);
  }
}

async function fetchWithRetry(url: string, options: RequestInit, retries: number): Promise<any> {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res.json();
      if (res.status === 404) return null; // вакансия не найдена — не ретраим
      if (i < retries - 1) await new Promise(r => setTimeout(r, delays[i]));
    } catch { if (i < retries - 1) await new Promise(r => setTimeout(r, delays[i])); }
  }
  return null;
}

async function refreshHHToken(managerId: string, refreshToken: string): Promise<boolean> {
  const res = await fetch('https://hh.ru/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.HH_CLIENT_ID!,
      client_secret: process.env.HH_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  await supabase.from('user_profiles').update({
    hh_access_token: data.access_token,
    hh_refresh_token: data.refresh_token,
    hh_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq('id', managerId);
  return true;
}

async function notifyAdmin(message: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID, text: message }),
  });
}

syncHH().catch(console.error);
```

---

### 5.5. Интеграция с HH.ru — встроенные звонки

**Источник:** HH.ru API, эндпоинт статистики звонков работодателя.
**Требование:** Аккаунт работодателя HH с активированной функцией встроенных звонков.
**Базовый URL:** `https://api.hh.ru`
**Аутентификация:** HMAC-SHA256 подпись (apiKey + apiSalt + JSON body)

**Подпись запроса:**
```typescript
import crypto from 'crypto';

// Функция подписи Манго — удалена (Манго не используется)
// Вместо неё: сбор звонков через HH API
function fetchHHCallsForManager(
  return crypto
    .createHash('sha256')
    .update(apiKey + body + apiSalt)
    .digest('hex');
}
```

**Cron-скрипт `scripts/sync-hh-calls.ts` (Beget VPS):**
```typescript
// Запускается: 0 20 * * 1-5 (ежедневно в 20:00 МСК, пн–пт)
// Собирает статистику встроенных звонков HH за сегодня для всех менеджеров

async function syncHHCalls() {
  const today = new Date().toISOString().split('T')[0]; // '2026-05-22'
  const log = await createSyncLog('hh'); // пишем в sync_logs

  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, hh_manager_id, hh_access_token')
    .eq('role', 'manager')
    .eq('is_active', true)
    .not('hh_manager_id', 'is', null);

  let updated = 0;
  for (const manager of managers ?? []) {
    try {
      // HH API: статистика встроенных звонков работодателя по менеджеру за дату
      const res = await fetch(
        `https://api.hh.ru/employers/${process.env.HH_EMPLOYER_ID}/statistics/calls?date_from=${today}&date_to=${today}&manager_id=${manager.hh_manager_id}`,
        {
          headers: {
            'Authorization': `Bearer ${manager.hh_access_token}`,
            'HH-User-Agent': 'HRControlTower/1.0 (hr@company.ru)',
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!res.ok) throw new Error(`HH calls API: HTTP ${res.status}`);

      const data = await res.json();
      // Находим запись по manager_id за дату
      const dayStats = (data.calls ?? []).find(
        (c: any) => c.manager_id === manager.hh_manager_id && c.date === today
      );
      const callsCount = dayStats?.calls_count ?? 0;

      // Upsert: не трогаем interviews_count, offers_count, notes
      await supabase.from('daily_activities').upsert({
        manager_id:      manager.id,
        activity_date:   today,
        hh_calls_count:  callsCount,
        hh_calls_source: 'hh_api',
      }, { onConflict: 'manager_id,activity_date' });

      updated++;
    } catch (err: any) {
      await notifyAdmin(`⚠️ HH Calls sync error для manager ${manager.id}: ${err.message}`);
    }
  }

  await finalizeSyncLog(log.id, 'ok', managers?.length ?? 0, updated);
}
```

**Fallback при недоступности HH:**
- При HTTP error или таймауте — поле `hh_calls_count` не обновляется в БД
- В API-ответе `/api/activities/[date]`: `hh_prefilled: false`, `hh_calls_source: 'pending'`
- В UI: Alert «Данные о звонках из HH не получены. Введите вручную.»

---

### 5.5a. Интеграция с Манго ВATС API (cron автоматический)

**Базовый URL:** `https://app.mango-office.ru/vpbx/`
**Аутентификация:** HMAC-SHA256 подпись: `sha256(api_key + json_body + api_salt)`
**Используется только для менеджеров у которых `mango_extension IS NOT NULL`**

**Эндпоинты Манго:**
```
POST /vpbx/stats/request   → создать задачу на получение статистики, получить ключ
POST /vpbx/stats/result    → получить результат по ключу (двухэтапный запрос)

Тело /vpbx/stats/request:
{
  "date_from": 1748822400,   // unix timestamp: начало дня (00:00 МСК)
  "date_to":   1748908799,   // unix timestamp: конец дня (23:59 МСК)
  "from": {
    "extension": "101"       // добавочный номер менеджера из user_profiles.mango_extension
  },
  "fields": "start,answer,from_extension,to_number,disconnect_reason"
}

Ответ /vpbx/stats/result:
[
  { "start": 1748830000, "answer": 1748830010, "from_extension": "101", "to_number": "79261234567", "disconnect_reason": "... " },
  { "start": 1748831000, "answer": null, ... }   // answer=null = не взяли трубку
]
```

**Считаем звонком:** строка где `answer IS NOT NULL` (кандидат поднял трубку).
**Решение:** принято считать все исходящие (`from.extension` = добавочный менеджера),
независимо от `answer` — рекрутёр совершил попытку звонка.
Это соответствует логике работы отдела: попытка = звонок.

**Cron-скрипт `scripts/sync-mango.ts` (Beget VPS):**
```typescript
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function mangoSign(apiKey: string, body: string, salt: string): string {
  return crypto.createHash('sha256').update(apiKey + body + salt).digest('hex');
}

async function syncMango() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateFrom = Math.floor(today.getTime() / 1000);
  const dateTo   = dateFrom + 86399; // 23:59:59

  const { data: managers } = await supabase
    .from('user_profiles')
    .select('id, mango_extension')
    .eq('role', 'manager')
    .eq('is_active', true)
    .not('mango_extension', 'is', null);

  for (const manager of managers ?? []) {
    try {
      const body = JSON.stringify({
        date_from: dateFrom,
        date_to:   dateTo,
        from: { extension: manager.mango_extension },
        fields: 'start,answer,from_extension,to_number,disconnect_reason'
      });

      const sign = mangoSign(process.env.MANGO_API_KEY!, body, process.env.MANGO_API_SALT!);

      // Шаг 1: создать задачу
      const reqRes = await fetch('https://app.mango-office.ru/vpbx/stats/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ vpbx_api_key: process.env.MANGO_API_KEY!, sign, json: body }),
        signal: AbortSignal.timeout(10000),
      });
      const reqKey = await reqRes.json(); // { key: "abc123" }

      // Шаг 2: получить результат
      const resultBody = JSON.stringify(reqKey);
      const resultSign = mangoSign(process.env.MANGO_API_KEY!, resultBody, process.env.MANGO_API_SALT!);
      const resultRes = await fetch('https://app.mango-office.ru/vpbx/stats/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ vpbx_api_key: process.env.MANGO_API_KEY!, sign: resultSign, json: resultBody }),
        signal: AbortSignal.timeout(10000),
      });
      const calls: any[] = await resultRes.json();
      const callsCount = calls.length; // все исходящие попытки за день

      const todayStr = new Date().toISOString().split('T')[0];
      await supabase.from('daily_activities').upsert({
        manager_id:          manager.id,
        activity_date:       todayStr,
        mango_calls_count:   callsCount,
        mango_calls_source:  'mango_api',
      }, { onConflict: 'manager_id,activity_date' });

    } catch (err: any) {
      await notifyAdmin(`⚠️ Манго sync error для ext=${manager.mango_extension}: ${err.message}`);
    }
  }
}
```

**Fallback при недоступности Манго:** `mango_calls_count` не обновляется, остаётся `mango_calls_source = 'pending'`.
В UI: Badge «Манго: ожидание» жёлтый, `Input` для ручного ввода появляется рядом.

---

### 5.5b. Загрузка CSV из HH «Аналитика подбора»

**Источник:** HH.ru → Аналитика подбора → нужный отчёт → кнопка «Скачать CSV» (или «Отправить на почту»)
**Кодировка файлов:** windows-1251 (стандарт для HH CSV)
**Загрузка:** вручную через `/sync`, кнопка в секции «Загрузка отчётов HH»

**Ключевое правило фильтрации:**
> При загрузке любого CSV из HH берём в анализ **только менеджеров из листа «HR менеджеры» Google Sheets**.
> Все остальные строки CSV (чужие менеджеры, уволенные, другие отделы) — **молча пропускаются**.
> Это ожидаемое поведение, не ошибка. Список «своих» = Google Sheets, единственный source of truth.

**Три типа CSV и их колонки:**

| Тип отчёта | Путь в HH | Ключевые колонки |
|-----------|-----------|-----------------|
| `calls` | Менеджеры → Звонки | Менеджер, Количество звонков |
| `politeness_managers` | Менеджеры → Индекс вежливости менеджеров | Менеджер, Индекс вежливости, Получено откликов, Отмечено просмотренными, Отправлено ответов, Среднее время ответа |
| `politeness_company` | Компания → Индекс вежливости компании | Индекс вежливости, Получено откликов, Отмечено просмотренными, Отправлено ответов |

**Логика обработки файла (`lib/hh-csv-parser.ts`):**
```typescript
import iconv from 'iconv-lite'; // npm install iconv-lite
import Papa from 'papaparse';  // npm install papaparse

// ─── Вспомогательные функции для сопоставления имён ──────────────────────────

/**
 * Нормализация имени: нижний регистр, убираем лишние пробелы,
 * разворачиваем «Фамилия И.О.» → «фамилия и о» для сравнения.
 * Примеры:
 *   "Иванова М."        → "иванова м"
 *   "Иванова Мария"     → "иванова мария"
 *   "  Иванова  Мария " → "иванова мария"
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, ' ')   // точки → пробелы (для инициалов)
    .replace(/\s+/g, ' ')  // множественные пробелы → один
    .trim();
}

/**
 * Fuzzy-match: ищет наиболее похожее имя из списка Sheets.
 * Использует коэффициент Дамерау–Левенштейна (нормализованный).
 * Возвращает лучший вариант с оценкой 0–1 (1 = полное совпадение).
 */
function findBestMatch(
  query: string,
  candidates: { normalized: string; original: string; userId: string }[]
): { userId: string; original: string; score: number } | null {
  let best: { userId: string; original: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = stringSimilarity(query, candidate.normalized);
    if (!best || score > best.score) {
      best = { userId: candidate.userId, original: candidate.original, score };
    }
  }
  return best;
}

/**
 * Нормализованное расстояние Левенштейна: 0 = полностью разные, 1 = идентичны.
 * Обрабатывает типичные расхождения HH vs Sheets:
 *   «Иванова М.» vs «Иванова Мария»   → ~0.75
 *   «Петров Алексей» vs «Петров А.»   → ~0.78
 *   «Козлов С» vs «Козлов Сергей»     → ~0.73
 */
function stringSimilarity(a: string, b: string): number {
  const longer  = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

// ─────────────────────────────────────────────────────────────────────────────

export async function parseHHCsv(
  fileBuffer: Buffer,
  reportType: 'calls' | 'politeness_managers' | 'politeness_company',
  statDate: string
): Promise<{ rows: HHStatRow[]; unmatched: string[] }> {

  // 1. Декодировать windows-1251 → UTF-8
  const decoded = iconv.decode(fileBuffer, 'win1251');

  // 2. Парсить CSV (разделитель — точка с запятой для HH)
  const { data } = Papa.parse(decoded, { header: true, delimiter: ';', skipEmptyLines: true });

  // 3. Загрузить список «своих» менеджеров из Google Sheets (hr_manager_syncs)
  //    ВСЕ имена из HH CSV, которых НЕТ в этом списке — ИГНОРИРУЮТСЯ.
  //    Это единственный source of truth для состава отдела.
  const { data: ourManagers } = await supabase
    .from('hr_manager_syncs')
    .select('sheet_full_name, user_profile_id')
    .eq('is_active_sheet', true);  // только активные в Sheets

  // Создаём структуры для точного и fuzzy-поиска
  // Map для точного O(1) поиска: нормализованное_имя → { userId, sheetName }
  const exactMap = new Map(
    (ourManagers ?? []).map(m => [
      normalizeName(m.sheet_full_name),
      { userId: m.user_profile_id, sheetName: m.sheet_full_name }
    ])
  );

  // Массив для fuzzy-match (если точный не сработал)
  const sheetNames = (ourManagers ?? []).map(m => ({
    normalized: normalizeName(m.sheet_full_name),
    original:   m.sheet_full_name,
    userId:     m.user_profile_id,
  }));

  const rows: HHStatRow[] = [];
  const skipped: string[] = [];   // не наши менеджеры — пропускаем

  for (const row of data as Record<string, string>[]) {
    // Для ИВ компании — менеджер не нужен, берём всегда
    if (reportType === 'politeness_company') {
      rows.push({
        manager_id: null,
        manager_name_hh: null,
        stat_date: statDate,
        politeness_index:   parseFloat(row['Индекс вежливости']?.replace(',', '.')),
        responses_received: parseInt(row['Получено откликов']),
        responses_viewed:   parseInt(row['Отмечено просмотренными']),
        responses_answered: parseInt(row['Отправлено ответов']),
        source_csv: 'politeness_company',
      });
      continue;
    }

    const managerName = row['Менеджер']?.trim();
    if (!managerName) continue;

    // ШАГ 1: точное совпадение по нормализованному имени
    const normalizedHH = normalizeName(managerName);
    let match = exactMap.get(normalizedHH);

    // ШАГ 2: fuzzy-match если точный не сработал (порог схожести 0.7)
    if (!match) {
      const best = findBestMatch(normalizedHH, sheetNames);
      if (best && best.score >= 0.7) {
        match = { userId: best.userId, sheetName: best.original };
      }
    }

    // ФИЛЬТР: если ни точный, ни fuzzy не дали результата → не наш менеджер → пропускаем
    if (!match?.userId) {
      skipped.push(managerName);
      continue;
    }

    rows.push({
      manager_id:      userId,
      manager_name_hh: managerName,
      stat_date:       statDate,
      hh_calls_count:  reportType === 'calls'
                         ? parseInt(row['Количество звонков'])
                         : undefined,
      politeness_index:   reportType.startsWith('politeness')
                            ? parseFloat(row['Индекс вежливости']?.replace(',', '.'))
                            : undefined,
      responses_received: parseInt(row['Получено откликов']),
      responses_viewed:   parseInt(row['Отмечено просмотренными']),
      responses_answered: parseInt(row['Отправлено ответов']),
      avg_response_hours: reportType === 'politeness_managers'
                            ? parseFloat(row['Среднее время ответа']?.replace(',', '.'))
                            : undefined,
      source_csv: reportType,
    });
  }

  // 4. Upsert в hh_manager_stats — только «свои» менеджеры
  if (rows.length > 0) {
    await supabase.from('hh_manager_stats').upsert(rows, {
      onConflict: 'manager_id,stat_date,source_csv'
    });
  }

  // 5. Если звонки — дублировать в daily_activities
  if (reportType === 'calls') {
    for (const row of rows.filter(r => r.manager_id && r.hh_calls_count != null)) {
      await supabase.from('daily_activities').upsert({
        manager_id:      row.manager_id,
        activity_date:   row.stat_date,
        hh_calls_count:  row.hh_calls_count,
        hh_calls_source: 'hh_csv',
      }, { onConflict: 'manager_id,activity_date' });
    }
  }

  // skipped — не наши менеджеры: не ошибка, ожидаемое поведение
  // Считаем сколько нашли через fuzzy (для информации в UI)
  const fuzzyMatchedCount = rows.filter(r => {
    const exact = exactMap.get(normalizeName(r.manager_name_hh ?? ''));
    return !exact && r.manager_id; // нашли через fuzzy, не через exact
  }).length;

  return { rows, skipped, fuzzyMatchedCount };
}
```

**Fallback при отсутствии CSV:** поля `politeness_index`, `hh_calls_count` в `hh_manager_stats` = NULL.
В дашборде: вместо числа ИВ — серый `Badge` «—» с tooltip «Загрузите CSV в разделе Синхронизация».

---

### 5.6. Интеграция с Google Sheets (три листа одного файла)

**Лист «HR менеджеры» — синхронизация списка действующих менеджеров:**
```typescript
// Читается при каждом /api/sync/sheets
// Столбцы: ФИО | Email | Подразделение | Активен (да/нет)
async function syncManagersList(rows: SheetRow[]) {
  for (const row of rows) {
    const sheetName = row['ФИО']?.trim();
    if (!sheetName) continue;

    // Сопоставление с user_profiles по email или полному имени
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id')
      .or(`email.eq.${row['Email']},full_name.ilike.${sheetName}`)
      .single();

    await supabase.from('hr_manager_syncs').upsert({
      sheet_full_name:  sheetName,
      user_profile_id:  profile?.id ?? null,
      email_sheet:      row['Email']?.trim() || null,
      is_active_sheet:  row['Активен']?.toLowerCase() !== 'нет',
      synced_at:        new Date().toISOString(),
    }, { onConflict: 'sheet_full_name' });
  }
}
```

**Автосоздание учётных записей при синхронизации листа «HR менеджеры»:**

- Если менеджер из Sheets не найден в `user_profiles` (`user_profile_id = NULL`),
  автоматически создаётся пользователь в `auth.users` + `user_profiles`
  (последнее — триггером `handle_new_user` из `user_metadata`).
- `role = 'manager'`, `full_name` = значение из колонки «ФИО».
- `email` = из колонки «Email» (если есть), иначе `{транслит_имени}@hr.local`
  (например, «Иванов Иван Иванович» → `ivanov.ivan.ivanovich@hr.local`).
- Временный пароль генерируется автоматически (`crypto.randomUUID()`);
  `email_confirm: true` — учётная запись активна сразу.
- После создания `hr_manager_syncs.user_profile_id` обновляется на новый id;
  в ответе sync возвращается `created_users: N`.
- **Идемпотентность:** перед `createUser` ищем профиль в `user_profiles` по
  fallback-email; если есть — берём существующий id. Повторный запуск не
  дублирует пользователей.
- **Ограничение:** учётки с адресом `@hr.local` не могут получать почту
  и логиниться, пока admin не выставит реальный email через `/admin/users`.
- **Тот же механизм** срабатывает при обработке колонки «Менеджеры» листа
  `Data`: если ФИО из строки вакансии не найдено в `user_profiles`, юзер
  создаётся, кэш `profileByNormName` обновляется на лету, и строка вакансии
  обрабатывается дальше (раньше тихо пропускалась → данные терялись).

**Дедуп вакансий из листа `Data`** (без `hh_vacancy_id`):

- Ключ — `(title, manager_id, opened_at)`. Если такая запись есть → UPDATE,
  иначе INSERT. Если `opened_at` пуст — всегда INSERT (дедуп невозможен).
- БД-уровень держит partial UNIQUE INDEX:
  ```sql
  CREATE UNIQUE INDEX uq_vacancies_title_manager_opened_no_hh
    ON vacancies (manager_id, title, opened_at)
    WHERE hh_vacancy_id IS NULL;
  ```
- Решает кейс: «Менеджер по продажам / Анисимова Диана» открытая в январе
  и в апреле — две независимые записи, при закрытии второй дата первой
  не перетирается.

**Лист `Data` — заголовок города** читается с алиасами (берём первый непустой):
`Населённый пункт` / `Населенный пункт` / `Город` / `Местоположение`.

**Лист «Бонусы_HR» — справочник тарифов «Должность → Стоимость»:**

Лист содержит две колонки: **Должность** (или «Позиция»/«Вакансия»/«Название») и
**Стоимость** (или «Сумма»/«Тариф») в рублях. НЕ журнал начислений — список
расценок «сколько платится за закрытие данной позиции».

> **Seed на проде:** 16 стартовых тарифов залиты миграцией
> `20260523210000_seed_bonus_rates` (`ON CONFLICT DO NOTHING` — не перетирают
> ручные правки). У записей есть опциональное поле `group_name` (Розница / Офис)
> для будущей группировки в UI (миграция `20260523200000_bonus_rates_group_name`).

```typescript
// Upsert в bonus_rates по position_name.
async function syncBonusRates(rows: SheetRow[]) {
  for (const row of rows) {
    const position = (
      row['Должность'] ?? row['Позиция'] ?? row['Вакансия'] ?? row['Название'] ?? ''
    ).trim();
    const amountKopecks = rublesToKopecks(
      row['Стоимость'] ?? row['Сумма'] ?? row['Тариф'] ?? '0',
    );
    if (position.length < 2 || amountKopecks <= 0) continue;

    await supabase.from('bonus_rates').upsert(
      { position_name: position, amount_kopecks: amountKopecks },
      { onConflict: 'position_name' },
    );
  }
}
```

**Расчёт бонусов на лету (RPC `compute_manager_bonuses`):**

Источник для `/api/bonuses` и `/api/bonuses/summary`. Параметры:
`p_from DATE`, `p_to DATE`, `p_manager_id UUID` (опц.), `p_threshold FLOAT = 0.6`.

```sql
SELECT he.id, v.manager_id, v.title AS vacancy_title, he.position_name,
       he.hired_date, br.amount_kopecks, br.similarity_score
FROM hired_employees he
LEFT JOIN vacancies v ON v.id = he.vacancy_id
LEFT JOIN LATERAL (
  SELECT id, position_name, amount_kopecks,
         similarity(position_name, he.position_name) AS score
  FROM bonus_rates
  WHERE similarity(position_name, he.position_name) >= 0.6
  ORDER BY score DESC LIMIT 1
) br ON TRUE
WHERE he.status = 'hired'
  AND he.hired_date BETWEEN $p_from AND $p_to
  AND ($p_manager_id IS NULL OR v.manager_id = $p_manager_id);
```

- `status = 'hired'` (стажёры — `status='probation'` — в бонусы не идут).
- Если тариф не найден (нет в `bonus_rates` или similarity < 0.6) — строка
  возвращается с `amount_kopecks = NULL` (UI показывает «Тариф не задан»,
  и эта строка не попадает в `total_amount_kopecks`).
- SECURITY DEFINER + GRANT EXECUTE TO authenticated; API форсит
  `p_manager_id = auth.uid()` для роли `manager`.
- В UI `/dashboard/efficiency` колонка «Бонус за месяц» (крайняя справа)
  использует тот же RPC, **всегда** с периодом `month` (независимо от
  таб-селектора today/week/month страницы).

**SQL-функция fuzzy_match_vacancy (создать в Supabase):**
```sql
CREATE OR REPLACE FUNCTION public.fuzzy_match_vacancy(
  search_title TEXT,
  threshold    FLOAT DEFAULT 0.8
)
RETURNS TABLE(id UUID, title TEXT, similarity_score FLOAT)
LANGUAGE SQL STABLE AS $$
  SELECT id, title, similarity(title, search_title) AS similarity_score
  FROM public.vacancies
  WHERE similarity(title, search_title) >= threshold
  ORDER BY similarity_score DESC
  LIMIT 1;
$$;
```

### 5.6b. Интеграция с Google Sheets (источник данных о закрытых вакансиях и найме)
(файл загружается вручную admin-ом через форму на `/admin/integrations`).

**Google Sheets API v4 — чтение данных:**
```typescript
// lib/google-sheets.ts
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key:  process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

export async function readVacanciesSheet(): Promise<Record<string, string>[]> {
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
    range: `${process.env.GOOGLE_SHEETS_VACANCIES_TAB}!A:Z`,
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = rows[0] as string[];
  return rows.slice(1).map((row, idx) => ({
    _rowIndex: String(idx + 2), // +2: заголовок строка 1, данные с 2
    ...Object.fromEntries(headers.map((h, i) => [h, (row as string[])[i] ?? '']))
  }));
}
```

**npm пакет:** `googleapis` (`npm install googleapis`)
Добавить в `package.json` → `dependencies`.

**Структура Google Sheets файла (ожидаемые заголовки столбцов):**

| Столбец | Пример значения | Маппинг |
|---------|----------------|---------|
| Название | «Менеджер по продажам (Москва)» | `vacancies.title` (fuzzy-match) |
| Статус | «закрыта» | фильтр для импорта |
| Дата открытия | «01.04.2026» | `vacancies.opened_at` |
| Дата закрытия | «23.05.2026» | `vacancies.closed_at` → `days_to_close` |
| Менеджер | «Иванова Мария» | опционально, для логов |
| Тип найма | «сотрудник» / «стажёр» | `hired_employees.employment_type` |

**Условие импорта строки:**
```typescript
const shouldImport = (row: SheetRow): boolean =>
  row['Статус']?.toLowerCase().trim() === 'закрыта'
  && !!row['Дата закрытия']?.trim();
```

**Парсинг дат** (формат DD.MM.YYYY из Google Sheets):
```typescript
function parseSheetDate(value: string): string {
  // '23.05.2026' → '2026-05-23'
  const [d, m, y] = value.trim().split('.');
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}
```

**Сопоставление с вакансиями (в `POST /api/sync/sheets`):**
```typescript
// Шаг 1: прямое совпадение по hh_vacancy_id
const { data: vacancy } = await supabase
  .from('vacancies')
  .select('id')
  .eq('hh_vacancy_id', employee.vacancy_id)
  .single();

// Шаг 2: если нет прямого — fuzzy match по названию должности (pg_trgm)
if (!vacancy) {
  const { data: fuzzyMatch } = await supabase.rpc('find_vacancy_by_title', {
    position_name: employee.position,
    similarity_threshold: 0.8
  });
  // find_vacancy_by_title — хранимая функция в Supabase:
  // SELECT id FROM vacancies WHERE similarity(title, position_name) > threshold
  // ORDER BY similarity(title, position_name) DESC LIMIT 1
}
```

**SQL-функция для fuzzy match:**
```sql
CREATE OR REPLACE FUNCTION public.find_vacancy_by_title(
  position_name TEXT,
  similarity_threshold FLOAT DEFAULT 0.8
)
RETURNS UUID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id
  FROM public.vacancies
  WHERE similarity(title, position_name) > similarity_threshold
    AND status = 'active'
  ORDER BY similarity(title, position_name) DESC
  LIMIT 1;
$$;
```

---

### 5.7. Система логирования

#### 5.7.1. Error Logs — логирование ошибок

**Универсальная функция записи ошибки (`lib/logger.ts`):**
```typescript
import { createClient } from '@supabase/supabase-js';

// Используем service_role — error_logs всегда пишутся даже при ошибках авторизации
const serviceSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type LogSource =
  | 'api' | 'cron_hh' | 'cron_mango' | 'cron_ai'
  | 'sync_sheets' | 'hh_csv_upload' | 'client';

export type LogSeverity = 'warning' | 'error' | 'critical';

interface LogErrorOptions {
  source:     LogSource;
  severity?:  LogSeverity;
  error_code?: string;
  message:    string;
  error?:     Error;
  context?:   Record<string, unknown>;
  user_id?:   string;
  http_method?: string;
  http_path?:   string;
  http_status?: number;
}

export async function logError(opts: LogErrorOptions): Promise<void> {
  try {
    await serviceSupabase.from('error_logs').insert({
      source:      opts.source,
      severity:    opts.severity ?? 'error',
      error_code:  opts.error_code ?? null,
      message:     opts.message.slice(0, 2000),
      stack_trace: opts.error?.stack?.slice(0, 10000) ?? null,
      context:     opts.context ?? null,
      user_id:     opts.user_id ?? null,
      http_method: opts.http_method ?? null,
      http_path:   opts.http_path ?? null,
      http_status: opts.http_status ?? null,
    });
  } catch {
    // Если запись лога сама упала — молча игнорируем, чтобы не создавать петлю
    console.error('[logger] Failed to write error_log:', opts.message);
  }
}
```

**Интеграция в API routes — глобальный error handler (`lib/api-helpers.ts`):**
```typescript
// Добавить в функцию errorResponse:
export async function handleApiError(
  err: unknown,
  request: Request,
  userId?: string
): Promise<NextResponse> {
  if (err instanceof ApiError) {
    // Ожидаемые ошибки (валидация, 404) — только warning если ≥500
    if (err.status >= 500) {
      await logError({
        source:      'api',
        severity:    'error',
        error_code:  err.code,
        message:     err.message,
        error:       err,
        user_id:     userId,
        http_method: request.method,
        http_path:   new URL(request.url).pathname,
        http_status: err.status,
      });
    }
    return errorResponse(err.status, err.code, err.message);
  }

  // Неожиданные ошибки — critical
  const message = err instanceof Error ? err.message : 'Unknown error';
  await logError({
    source:      'api',
    severity:    'critical',
    error_code:  'UNHANDLED_ERROR',
    message,
    error:       err instanceof Error ? err : undefined,
    user_id:     userId,
    http_method: request.method,
    http_path:   new URL(request.url).pathname,
    http_status: 500,
  });

  return errorResponse(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера');
}
```

**Интеграция в cron-скрипты (пример для sync-mango.ts):**
```typescript
// В каждом catch блоке cron:
} catch (err: any) {
  await logError({
    source:     'cron_mango',
    severity:   err.message?.includes('timeout') ? 'warning' : 'error',
    error_code: err.code ?? 'MANGO_SYNC_ERROR',
    message:    err.message,
    error:      err,
    context:    { manager_id: manager.id, mango_extension: manager.mango_extension, date: today },
  });
  // Также уведомляем admin в Telegram если severity=critical
  if (isCritical(err)) await notifyAdmin(`🔴 ${err.message}`);
}
```

**Правила severity:**
| Ситуация | Severity |
|----------|---------|
| Валидационная ошибка (422) | не логируем |
| 404 Not Found | не логируем |
| Таймаут внешнего сервиса (Манго, HH, Sheets) | `warning` |
| 401/403 от внешнего сервиса | `error` |
| Неожиданное исключение в API | `critical` |
| Падение cron-скрипта целиком | `critical` |
| Частичная ошибка в cron (1 из N записей) | `error` |

---

#### 5.7.2. Audit Logs — отслеживание изменений

**Что логируется автоматически (через PostgreSQL триггеры):**

| Таблица | INSERT | UPDATE | DELETE | Примечание |
|---------|--------|--------|--------|-----------|
| `user_profiles` | ✓ | ✓ | ✓ | Изменение ролей, деактивация |
| `vacancies` | ✓ | ✓ | ✓ | Статус, менеджер, даты |
| `manager_plans` | ✓ | — | — | Только INSERT (история планов) |
| `staffing_records` | ✓ | — | ✓ | % укомплектованности |
| `hired_employees` | ✓ | ✓ | — | Синхронизация из Sheets |
| `hr_bonuses` | ✓ | ✓ | — | Начисление и статус бонусов |
| `daily_activities` | — | — | — | Слишком частые изменения, не логируем |
| `vacancy_snapshots` | — | — | — | Иммутабельны, не нужно |

**Пример diff в UI:** изменение плана менеджера:
```json
// old_values (только изменившиеся поля):
{ "calls_per_day": 15 }

// new_values:
{ "calls_per_day": 20 }
```
В UI рендерится как: `calls_per_day: 15 → 20` с зелёной стрелкой.

**Системные изменения (cron):**
Когда cron меняет данные через `SUPABASE_SERVICE_ROLE_KEY`, `auth.uid()` возвращает NULL.
Триггер записывает `user_id = NULL, user_role = 'system'`.
В UI отображается как «Система (cron)» с иконкой `Bot`.

---

### 5.8. Безопасность

**CORS:**
В `next.config.ts` добавить headers:
```typescript
async headers() {
  return [{
    source: '/api/:path*',
    headers: [
      { key: 'Access-Control-Allow-Origin', value: process.env.ALLOWED_ORIGIN ?? 'https://hr.company.ru' },
      { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
    ],
  }];
}
```

**Rate limiting:** Nginx на Beget VPS: `limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;`

**Input sanitization:** все строки через `z.string().trim()` в Zod-схемах.
SQL-инъекции исключены — используется Supabase JS SDK (prepared statements).

**152-ФЗ:** таблица `hired_employees` содержит названия должностей (без ФИО — ФИО не импортируется из Sheets). Доступ по RLS только для head/admin/executive.
Данные не передаются третьим лицам. Логи не содержат ФИО.
Уведомление Роскомнадзора подаётся до запуска в production.

---

### 5.9. Cron-расписание (pm2-cron на Beget VPS)

| Скрипт | Расписание (UTC+3) | Что делает |
|--------|-------------------|-----------|
| `sync-hh.ts` | `0 8,10,12,14,16,18,20,22 * * 1-5` | Синхронизация HH.ru: отклики и резюме по всем активным вакансиям |
| `sync-mango.ts` | `0 20 * * 1-5` | Синхронизация звонков Манго по добавочному (менеджеры с mango_extension) |
| `refresh-hh-tokens.ts`      | `0 7 * * *`    | Проверка и обновление HH-токенов, истекающих в течение 24ч |
| `generate-weekly-report.ts` | `30 20 * * 5`  | AI-анализ (аномалии, прогнозы, рекомендации) + еженедельный отчёт |

**pm2 ecosystem.config.js:**
```javascript
module.exports = {
  apps: [
    {
      name: 'sync-hh',
      script: './dist/scripts/sync-hh.js',
      cron_restart: '0 8,10,12,14,16,18,20,22 * * 1-5',
      autorestart: false,
      watch: false,
    },
    {
      name: 'sync-mango',
      script: './dist/scripts/sync-mango.js',
      cron_restart: '0 20 * * 1-5',
      autorestart: false,
      watch: false,
    },
    {
      name: 'refresh-hh-tokens',
      script: './dist/scripts/refresh-hh-tokens.js',
      cron_restart: '0 7 * * *',
      autorestart: false,
      watch: false,
    },
    {
      name: 'ai-weekly-report',
      script: './dist/scripts/generate-weekly-report.js',
      cron_restart: '30 20 * * 5',
      autorestart: false,
      watch: false,
    },
  ],
};
```

---

### 5.10. AI-анализ: аномалии, прогнозы, рекомендации, еженедельный отчёт

**Модель:** `claude-sonnet-4-5` (Anthropic Messages API)
**Запросы:** только с Vercel Next.js API routes (серверный код, ключ не попадает в браузер)
**Стоимость:** ~$0.003 за один run полного анализа отдела (≈5000 токен input + 1500 output)
**Rate limit on-demand:** 1 запуск в 2 часа на компанию (хранится в Supabase, проверяется перед запуском)

---

#### 5.10.1. Аномалии (`insight_type = 'anomaly'`)

**Триггер:** еженедельный cron пятница 20:30 + on-demand кнопка руководителя

**Что считается аномалией:**
```typescript
// lib/ai/anomaly-rules.ts
export const ANOMALY_RULES = {
  calls_pct_drop:   { threshold: 70, severity: 'high',   label: 'Резкое падение звонков' },
  calls_pct_warn:   { threshold: 80, severity: 'medium', label: 'Звонки ниже нормы' },
  iv_drop_points:   { threshold: 10, severity: 'high',   label: 'Падение ИВ более 10 пп' },
  iv_low:           { threshold: 70, severity: 'medium', label: 'ИВ ниже 70%' },
  zero_calls_days:  { threshold: 2,  severity: 'high',   label: 'Более 2 дней без звонков' },
  interviews_pct:   { threshold: 70, severity: 'medium', label: 'Собеседования ниже 70% плана' },
};
```

**Промпт для аномалии (один менеджер):**
```typescript
// lib/ai/prompts.ts
export function buildAnomalyPrompt(data: ManagerWeekData): string {
  return `Ты — HR-аналитик. Проанализируй данные рекрутёра за неделю и выяви аномалии.

ДАННЫЕ РЕКРУТЁРА:
Имя: ${data.fullName}
Период: ${data.periodStart} — ${data.periodEnd}

KPI за неделю:
- Звонки: ${data.callsFact} / ${data.callsPlan} (${data.callsPct}%)
- Звонки предыдущей недели: ${data.prevCallsPct}%
- Собеседования: ${data.interviewsFact} / ${data.interviewsPlan} (${data.interviewsPct}%)
- Выведено: ${data.hiresFact} / ${data.hiresPlan}
- Индекс вежливости: ${data.politenessIndex ?? 'нет данных'}%
- ИВ предыдущей недели: ${data.prevPolitenessIndex ?? 'нет данных'}%
- Дней без звонков: ${data.zeroCullsDays}

ПРАВИЛА ФЛАГОВ: ${JSON.stringify(ANOMALY_RULES)}

ЗАДАЧА:
1. Определи, есть ли аномалии согласно правилам
2. Если есть — напиши краткий заголовок (до 120 символов) и развёрнутый анализ (150–300 слов)
3. Дай конкретную рекомендацию руководителю что сделать
4. Если аномалий нет — верни JSON { "has_anomaly": false }

ФОРМАТ ОТВЕТА (только JSON, без markdown-обёртки):
{
  "has_anomaly": true,
  "severity": "high",
  "title": "Резкое падение звонков: Петров А. — 52% при норме ≥80%",
  "body_md": "## Аномалия: низкая активность\n\n...",
  "recommendation": "Рекомендуется провести 1-на-1 встречу с менеджером..."
}`;
}
```

**Код генерации (серверный, `lib/ai/generate-anomalies.ts`):**
```typescript
import Anthropic from '@anthropic-ai/sdk'; // npm install @anthropic-ai/sdk

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateAnomalyForManager(
  managerId: string,
  weekData: ManagerWeekData
): Promise<void> {
  const prompt = buildAnomalyPrompt(weekData);

  // Быстрая проверка правил ДО вызова AI — не тратить токены если нет флагов
  const hasAnyFlag = Object.entries(ANOMALY_RULES).some(([key, rule]) => {
    if (key === 'calls_pct_drop' || key === 'calls_pct_warn')
      return weekData.callsPct < rule.threshold;
    if (key === 'iv_drop_points')
      return weekData.prevPolitenessIndex &&
             (weekData.prevPolitenessIndex - (weekData.politenessIndex ?? 100)) >= rule.threshold;
    if (key === 'iv_low')
      return weekData.politenessIndex && weekData.politenessIndex < rule.threshold;
    if (key === 'zero_calls_days')
      return weekData.zeroCullsDays >= rule.threshold;
    if (key === 'interviews_pct')
      return weekData.interviewsPct < rule.threshold;
    return false;
  });

  if (!hasAnyFlag) return; // Нет флагов → не вызываем AI, экономим токены

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  const result = JSON.parse(raw.replace(/```json|```/g, '').trim());

  if (!result.has_anomaly) return;

  const today = new Date().toISOString().split('T')[0];
  await supabase.from('ai_insights').insert({
    insight_type:  'anomaly',
    period_start:  weekData.periodStart,
    period_end:    weekData.periodEnd,
    manager_id:    managerId,
    severity:      result.severity,
    title:         result.title,
    body_md:       result.body_md,
    meta_json:     {
      calls_fact:        weekData.callsFact,
      calls_plan:        weekData.callsPlan,
      calls_pct:         weekData.callsPct,
      prev_week_pct:     weekData.prevCallsPct,
      iv:                weekData.politenessIndex,
      zero_calls_days:   weekData.zeroCullsDays,
    },
    tokens_used:   message.usage.input_tokens + message.usage.output_tokens,
    triggered_by:  'cron',
  });
}
```

---

#### 5.10.2. Прогнозы (`insight_type = 'forecast'`)

**Формула (без AI — чистая математика):**
```typescript
// lib/ai/forecast.ts
export function calcForecast(data: ManagerMonthData): ForecastResult {
  const workdaysTotal  = countWorkdays(data.monthStart, data.monthEnd);
  const workdaysPassed = countWorkdays(data.monthStart, new Date());
  const workdaysLeft   = workdaysTotal - workdaysPassed;

  const hiresPace = workdaysPassed > 0
    ? data.hiresFact / workdaysPassed   // выводов в день по факту
    : 0;

  const forecastHires = data.hiresFact + Math.round(hiresPace * workdaysLeft);
  const forecastPct   = Math.round((forecastHires / data.hiresPlan) * 100);

  return {
    hires_fact:    data.hiresFact,
    hires_plan:    data.hiresPlan,
    forecast_hires: forecastHires,
    forecast_pct:  forecastPct,
    days_left:     workdaysLeft,
    pace_per_day:  hiresPace,
  };
}
```

**AI добавляет только текстовую интерпретацию** (промпт короткий, ≈300 токен):
```typescript
export function buildForecastPrompt(name: string, f: ForecastResult): string {
  return `Рекрутёр ${name}. Факт: ${f.hires_fact}/${f.hires_plan} выводов. Прогноз на конец месяца: ${f.forecast_pct}%. Осталось ${f.days_left} рабочих дней. Темп: ${f.pace_per_day.toFixed(1)} вывода/день. Напиши 2–3 предложения: как идёт месяц и что нужно сделать. Без заголовков, только текст.`;
}
```

---

#### 5.10.3. Рекомендации по воронке (`insight_type = 'recommendation'`)

**Триггер:** вакансии где конверсия `contacts_opened → hh_calls_count < 40%` И открыты более 14 дней.

**Промпт:**
```typescript
export function buildRecommendationPrompt(vacancy: VacancyFunnelData): string {
  return `HR-вакансия: "${vacancy.title}" (открыта ${vacancy.daysOpen} дней).

Воронка:
- Откликов: ${vacancy.responses}
- Открыто контактов: ${vacancy.contactsOpened} (${vacancy.contactsPct}% от откликов)
- Сделано звонков: ${vacancy.calls} (${vacancy.callsFromContactsPct}% от контактов, норма ≥40%)
- Собеседований: ${vacancy.interviews}
- Стажируются: ${vacancy.interns}
- Выведено: ${vacancy.hired}
- Среднее по отделу на аналогичных вакансиях: звонков ${vacancy.avgCallsPct}%

Определи узкое место в воронке и дай 2–3 конкретные рекомендации рекрутёру.
Формат: JSON { "bottleneck_stage": "contacts_to_calls", "title": "...", "body_md": "..." }`;
}
```

---

#### 5.10.4. Еженедельный отчёт (`insight_type = 'weekly_report'`)

**Триггер:** cron каждую пятницу в 20:30 МСК

**Данные для промпта** (собираются перед вызовом AI):
```typescript
interface WeeklyReportData {
  period:           string;          // "19–25 мая 2026"
  team_calls_pct:   number;          // % выполнения плана по звонкам
  team_interviews_pct: number;
  team_hires_pct:   number;
  company_iv:       number | null;   // ИВ компании
  staffing_pct:     number;          // % укомплектованности
  managers:         ManagerWeekSummary[];  // KPI каждого менеджера
  anomalies:        string[];        // заголовки аномалий за неделю
  vacancies_at_risk: string[];       // вакансии с низкой конверсией
  top_manager:      string;          // имя лучшего менеджера недели
  bottom_manager:   string;          // имя менеджера с наименьшим %
}
```

**Промпт:**
```typescript
export function buildWeeklyReportPrompt(data: WeeklyReportData): string {
  return `Ты — HR-аналитик. Напиши еженедельный отчёт для руководителя HR-отдела.

ДАННЫЕ НЕДЕЛИ (${data.period}):
Отдел:
- Звонки: ${data.team_calls_pct}% от плана
- Собеседования: ${data.team_interviews_pct}% от плана
- Выведено: ${data.team_hires_pct}% от плана
- Индекс вежливости компании: ${data.company_iv ?? 'нет данных'}%
- Укомплектованность: ${data.staffing_pct}%

Менеджеры:
${data.managers.map(m => `- ${m.name}: звонки ${m.callsPct}%, собесед ${m.interviewsPct}%, выведено ${m.hiresFact}/${m.hiresPlan}`).join('
')}

Лучший: ${data.top_manager}
Требует внимания: ${data.bottom_manager}

Аномалии недели: ${data.anomalies.length > 0 ? data.anomalies.join('; ') : 'нет'}
Вакансии в риске: ${data.vacancies_at_risk.length > 0 ? data.vacancies_at_risk.join(', ') : 'нет'}

ЗАДАЧА:
Напиши отчёт в формате Markdown (500–700 слов):
1. ## Итоги недели (2–3 предложения — общая оценка)
2. ## KPI отдела (таблица или список с оценкой)
3. ## Менеджеры (топ и те кто отстаёт — конкретно)
4. ## Вакансии (проблемные позиции и рекомендации)
5. ## Приоритеты на следующую неделю (3 пункта)

Тон: деловой, конкретный, без воды. Используй цифры.`;
}
```

**Полный код cron `scripts/generate-weekly-report.ts`:**
```typescript
// Запускается: 30 20 * * 5 (пятница 20:30 МСК)
async function generateWeeklyReport() {
  const { periodStart, periodEnd, weekStr } = getCurrentWeekRange();

  // Проверка: отчёт за эту неделю уже есть?
  const { data: existing } = await supabase
    .from('ai_insights')
    .select('id')
    .eq('insight_type', 'weekly_report')
    .gte('period_start', periodStart)
    .single();
  if (existing) return; // Идемпотентность

  // 1. Собрать все данные
  const weekData = await collectWeekData(periodStart, periodEnd);

  // 2. Сначала сгенерировать аномалии
  for (const manager of weekData.managers) {
    await generateAnomalyForManager(manager.id, manager);
    await generateForecastForManager(manager.id, manager);
  }

  // 3. Рекомендации по проблемным вакансиям
  const riskyVacancies = await findRiskyVacancies();
  for (const vacancy of riskyVacancies) {
    await generateRecommendation(vacancy);
  }

  // 4. Итоговый отчёт
  const reportData = await buildReportData(weekData, periodStart, periodEnd);
  const prompt = buildWeeklyReportPrompt(reportData);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const bodyMd = message.content[0].type === 'text' ? message.content[0].text : '';

  await supabase.from('ai_insights').insert({
    insight_type:  'weekly_report',
    period_start:  periodStart,
    period_end:    periodEnd,
    title:         `Еженедельный отчёт HR-отдела: неделя ${reportData.period}`,
    body_md:       bodyMd,
    meta_json:     {
      week:            weekStr,
      top_manager:     reportData.top_manager,
      bottom_manager:  reportData.bottom_manager,
      anomalies_count: reportData.anomalies.length,
      vacancies_at_risk: reportData.vacancies_at_risk,
    },
    tokens_used:   message.usage.input_tokens + message.usage.output_tokens,
    triggered_by:  'cron',
  });
}
```

**Cron-расписание (добавить в pm2 ecosystem):**
```javascript
{ name: 'ai-weekly-report', script: './dist/scripts/generate-weekly-report.js',
  cron_restart: '30 20 * * 5', autorestart: false, watch: false }
```

**Мониторинг стоимости:**
```sql
-- Запрос для отслеживания расходов AI за неделю
SELECT
  DATE_TRUNC('week', created_at) AS week,
  insight_type,
  COUNT(*) AS count,
  SUM(tokens_used) AS total_tokens,
  ROUND(SUM(tokens_used) * 0.000003, 4) AS est_cost_usd  -- claude-sonnet-4-5 ~$3/1M tokens
FROM ai_insights
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

---

## БЛОК 6: Edge Cases

### EC-00b: Запись в error_log сама упала (БД недоступна)

**Ситуация:** Cron пытается записать ошибку в `error_logs`, но Supabase временно недоступен.

**Поведение:**
- `logError()` оборачивает INSERT в `try/catch`
- При падении самого логера → `console.error('[logger] Failed to write error_log')` в stdout pm2
- pm2 сохраняет stdout/stderr в файл `~/.pm2/logs/sync-mango-error.log`
- Основная ошибка при этом всё равно корректно обработана (петли нет)
- Admin может проверить pm2-логи через `/admin/logs` или SSH на Beget VPS

---

### EC-00c: Audit триггер срабатывает при массовом импорте из Sheets (N записей)

**Ситуация:** Синхронизация Sheets делает upsert 50 записей `hired_employees` → 50 INSERT в audit_logs за секунду.

**Поведение:** Это штатная ситуация, триггер работает на уровне PostgreSQL и не замедляет upsert значимо.
В UI audit trail: 50 строк с `user_id = NULL, user_role = 'system'` — фильтруются по `action=INSERT AND table=hired_employees`.

---

### EC-00: В CSV из HH есть менеджеры которых нет в Google Sheets

**Ситуация:** Компания большая, в HH зарегистрированы рекрутёры других отделов. При загрузке CSV «Индекс вежливости менеджеров» в файле 12 строк — 5 наших и 7 чужих.

**Поведение:**
- Система загружает список «своих» из `hr_manager_syncs` (источник: лист «HR менеджеры» Sheets)
- Строки CSV, имя которых не найдено в `hr_manager_syncs` → `continue`, не сохраняются в БД
- API ответ: `{ "rows_matched": 5, "rows_skipped": 7, "skipped_names": [...] }`
- UI: зелёный Badge «5 менеджеров загружено», серый Collapsible «Пропущено 7: [список]»
- Это **НЕ ошибка** — правильная работа системы

**Fuzzy-match для имён:**
HH часто пишет «Иванова М.» а в Sheets «Иванова Мария» — прямой поиск не найдёт.
Поэтому при несовпадении запускается fuzzy (Левенштейн, порог 0.7).
В UI после загрузки: жёлтый блок «Сопоставлено через fuzzy: 2» с парами имён для проверки.

**Почему Sheets — источник истины:**
Состав нашего HR-отдела ведёт руководитель в листе «HR менеджеры».
HH не знает об оргструктуре — там могут быть все рекрутёры компании.

---

### EC-01: Менеджер пытается ввести активности за дату старше 7 дней

**Ситуация:** Менеджер был в отпуске и хочет ввести данные за 10 дней назад.

**Поведение:**
- DatePicker: даты старше 7 дней кликабельны, но при попытке отправить формы → показывает inline-ошибку
- API возвращает 422: `{ "error": { "code": "DATE_TOO_OLD", "message": "Можно вводить данные только за последние 7 дней" } }`
- GET `/api/activities/[date]` за старую дату работает (можно читать, нельзя писать)

**Решение для head/admin:** через `/api/activities` с `manager_id` в теле — голова может ввести данные за любой период (без ограничения 7 дней) для корректировки.

---

### EC-02: Cron HH обновил hh_calls_count, который менеджер уже ввёл вручную

**Ситуация:** Менеджер в 18:00 ввёл 25 звонков вручную (`hh_calls_source = 'manual'`). Cron в 20:00 получил из HH API 28 звонков.

**Поведение:**
- Cron делает upsert: обновляет `hh_calls_count = 28` и `hh_calls_source = 'hh_api'`
- При следующем входе менеджер видит 28 с текстом «Источник: HH.ru встроенные звонки» вместо `PencilLine`
- Информация о ручном вводе теряется — приемлемо: данные HH API более точны

**Обоснование:** Данные HH API считаются источником правды для звонков.

---

### EC-03: HH.ru вернул 404 для активной вакансии

**Ситуация:** Вакансия была удалена/заархивирована на HH.ru, но в БД `status = 'active'`.

**Поведение в cron:**
```typescript
if (res.status === 404) {
  // Автоматически закрываем вакансию
  await supabase.from('vacancies').update({ status: 'closed', closed_at: today }).eq('id', vacancy.id);
  // Логируем как partial (не ошибка, штатная ситуация)
  errors.push(`AUTO_CLOSED: hh_vacancy_id=${vacancy.hh_vacancy_id}`);
}
```
- Данные воронки сохраняются (не удаляются)
- В UI вакансия переходит в раздел «Закрытые»

---

### EC-04: Google Sheets содержит строку без совпадения с вакансией (fuzzy-match не сработал)

**Ситуация:** Название в Sheets — «Старший менеджер», в системе — «Senior Manager по продажам». Сходство < 0.8.

**Поведение:**
- `hired_employees` создаётся с `vacancy_id = NULL`, `position_name` = название из Sheets
- Ответ `/api/sync/sheets` содержит `unmatched_vacancies: 2`
- Toast после синхронизации: «18 закрыто, 2 без привязки — проверьте раздел интеграций»
- В `/admin/integrations` — таблица «Несопоставленные» с возможностью ручной привязки к вакансии (`PATCH /api/hired/{id}` с `vacancy_id`)

---

### EC-05: Два администратора одновременно обновляют план менеджера

**Ситуация:** Два admin открыли `/plan` одновременно и сохраняют разные значения.

**Поведение:**
- В таблице `manager_plans` создаются ДВЕ записи с одинаковым `effective_from`
- Активный план = последний по `created_at` (последний INSERT выигрывает)
- Конфликт не критичен: оба плана остаются в истории, применяется самый свежий

**Почему не блокировка:** избыточно для внутреннего инструмента с небольшой командой.

---

### EC-06: Повторный запуск синхронизации Google Sheets пока предыдущий ещё работает

**Ситуация:** Руководитель нажал «Синхронизировать» дважды.

**Поведение:**
- `POST /api/sync/sheets` проверяет: `SELECT id FROM sync_logs WHERE source='sheets' AND status='running' AND started_at > now() - interval '10 minutes'`
- Если есть → 409: `{ "error": { "code": "SYNC_ALREADY_RUNNING", "message": "..." } }`
- Кнопка в UI сразу переходит в `disabled` после первого нажатия, до получения ответа API

---

### EC-07: Manager видит вакансии другого менеджера

**Ситуация:** Менеджер пытается подобрать UUID чужой вакансии и открыть её.

**Поведение:**
- RLS на таблице `vacancies`: `manager_id = auth.uid()` для роли `manager`
- `GET /api/vacancies/[id]` → Supabase вернёт пустой результат → API возвращает 404
- Нет информации о том, что вакансия существует

---

### EC-08: HH-токен истёк у менеджера который больше не работает

**Ситуация:** Менеджер уволен, `is_active = false`, но его вакансии ещё активны с `hh_vacancy_id`.

**Поведение в cron:**
- При `is_active = false` менеджер исключается из запроса `SELECT` в cron
- Вакансии без активного токена получают `responses_count` и `views_count` из последнего успешного snapshot
- В `/admin/integrations` — Alert: «Следующие вакансии не синхронизируются: [список]»

**Решение:**
- Admin переназначает вакансию на другого менеджера (`vacancies.manager_id = new_manager_id`)
- Или выводит вакансию из активных (`status = 'closed'`)

---

### EC-09: Executive пытается получить данные менеджеров через API напрямую

**Ситуация:** Executive делает `GET /api/dashboard/team` и получает список менеджеров с именами.

**Поведение:**
- В `getAuthUser()` определяется `role = 'executive'`
- В хендлере: `if (role === 'executive') { result.managers = null; }`
- RLS дополнительно: `user_profiles` не доступны для `executive` через прямой Supabase-запрос

---

### EC-10: Форма кабинета зависает при медленном интернете

**Ситуация:** Менеджер нажал «Сохранить», запрос идёт > 5 сек.

**Поведение:**
- Кнопка «Сохранить» переходит в `disabled` сразу при нажатии (optimistic lock на кнопке)
- После ответа API: кнопка снова активна + toast
- Если запрос > 10 сек → клиентский таймаут: `AbortController` с `signal.timeout(10000)` → `toast.error('Сервер не отвечает. Проверьте соединение')`
- Данные формы сохраняются в `localStorage` как черновик — при перезагрузке форма восстанавливается

