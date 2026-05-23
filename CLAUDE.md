# HR Control Tower — Claude Code Project Guide

> Внутренняя HR-аналитическая платформа. Читай этот файл перед каждой задачей.
> Spec: SPEC.md | Версия: 1.0 | Статус: активная разработка

---

## 🏗️ Стек

| Слой | Технология |
|------|-----------|
| Frontend | Next.js 15 App Router, TypeScript 5.4, Tailwind CSS v4, shadcn/ui |
| Backend | Supabase (PostgreSQL 17, Auth, RLS) |
| Деплой | Vercel (фронт) + Beget VPS / pm2 (cron) |
| AI | Anthropic Messages API (`claude-sonnet-4-5`) |
| Интеграции | HH.ru API v3, Манго ВATС API, Google Sheets API v4, Telegram Bot API |
| Валидация | Zod 3.x |
| UI-компоненты | shadcn/ui, Lucide React, recharts, react-markdown, sonner |

---

## 📁 Структура проекта

```
hr-control-tower/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # layout без sidebar: /login
│   ├── (app)/                  # layout с sidebar: все защищённые маршруты
│   │   ├── cabinet/            # кабинет менеджера
│   │   ├── dashboard/          # дашборды (/, /efficiency, /divisions, /manager)
│   │   ├── vacancies/          # список и воронка вакансий
│   │   ├── bonuses/            # бонусы HR
│   │   ├── ai/                 # AI-инсайты и отчёты
│   │   ├── plan/               # планы менеджеров
│   │   ├── staffing/           # % укомплектованности
│   │   ├── sync/               # синхронизации
│   │   └── admin/              # пользователи, интеграции, логи
│   └── api/                    # API routes
│       ├── activities/
│       ├── vacancies/
│       ├── dashboard/
│       ├── plans/
│       ├── staffing/
│       ├── sync/
│       ├── stats/
│       ├── bonuses/
│       ├── ai/
│       └── admin/
├── lib/                        # shared utilities
│   ├── supabase/               # server.ts, client.ts
│   ├── api-helpers.ts          # getAuthUser, requireRole, errorResponse, logError
│   ├── logger.ts               # logError() → error_logs table
│   ├── kpi.ts                  # calcForecast, getManagerStatus
│   ├── hh-csv-parser.ts        # parseHHCsv, normalizeName, fuzzy-match
│   ├── google-sheets.ts        # readVacanciesSheet, readManagersSheet, readBonusesSheet
│   ├── ai/
│   │   ├── prompts.ts          # buildAnomalyPrompt, buildForecastPrompt, buildWeeklyReportPrompt
│   │   └── generate-*.ts      # generate anomaly, forecast, recommendation
│   └── utils.ts
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── AppLayout.tsx
│   └── ui/                     # shadcn/ui компоненты
├── scripts/                    # cron-скрипты для Beget VPS
│   ├── sync-hh.ts
│   ├── sync-mango.ts
│   ├── refresh-hh-tokens.ts
│   └── generate-weekly-report.ts
├── types/                      # глобальные TypeScript типы
│   └── index.ts
├── middleware.ts               # защита роутов, redirect по роли
├── SPEC.md                     # ЕДИНСТВЕННЫЙ источник истины
└── .env.local                  # переменные окружения (не коммитить)
```

---

## 🔑 Роли пользователей

| Роль | Код | Доступ |
|------|-----|--------|
| HR-менеджер | `manager` | `/cabinet`, `/vacancies` (свои), `/dashboard/manager` |
| Руководитель HR | `head` | Всё кроме `/admin/*` |
| Топ-менеджмент | `executive` | `/dashboard`, `/staffing` (read-only, без имён менеджеров) |
| Администратор | `admin` | Полный доступ включая `/admin/*` |

---

## ⚡ Ключевые правила разработки

### 1. SPEC.md — единственный источник истины
Перед любой задачей: `Read SPEC.md` → найди нужный блок → реализуй точно по спецификации.
Не выдумывай архитектуру — она уже описана. Если что-то не указано — спроси, не предполагай.

### 2. Авторизация — всегда через getAuthUser()
```typescript
// В каждом API route:
const { userId, role, fullName } = await getAuthUser();
requireRole(role, ['head', 'admin']); // если нужна конкретная роль
```
Никогда не доверяй данным из тела запроса для определения роли.

### 3. RLS включён на всех таблицах
Supabase client с anon/user токеном → RLS применяется автоматически.
Service role (cron, синхронизации) → используй `SUPABASE_SERVICE_ROLE_KEY` ТОЛЬКО на сервере.
Никогда не передавай service_role_key на клиент.

### 4. Ошибки — через logError()
```typescript
import { logError } from '@/lib/logger';

try {
  // ...
} catch (err) {
  await logError({
    source: 'api',           // или 'cron_hh', 'cron_mango', etc.
    severity: 'error',
    error_code: 'MY_ERROR',
    message: err.message,
    error: err,
    context: { relevant: 'data' },
    user_id: userId,
  });
  return errorResponse(500, 'MY_ERROR', 'Описание для пользователя');
}
```

### 5. Деньги — в копейках (INTEGER)
`bonus_amount_kopecks: 5000000` = 50 000 руб.
Отображение: `(kopecks / 100).toLocaleString('ru-RU') + ' ₽'`

### 6. Даты
- В БД: `DATE` (YYYY-MM-DD) и `TIMESTAMPTZ`
- Парсинг из Sheets: `DD.MM.YYYY` → `YYYY-MM-DD` через `parseSheetDate()`
- Unix timestamp для Манго API: `Math.floor(Date.now() / 1000)`

### 7. Источники звонков — два, суммируются
```typescript
const totalCalls = (mango_calls_count ?? 0) + (hh_calls_count ?? 0);
```
У менеджера может быть только Манго, только HH, или оба — нормальная ситуация.

### 8. Фильтр CSV из HH — только наши менеджеры
При парсинге CSV из HH используй `ourManagerMap` из `hr_manager_syncs`.
Строки не из нашего Sheets-списка → `continue`, молча пропускаются.

### 9. AI — через lib/ai/, только на сервере
```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```
Никогда не вызывай Anthropic API из клиентского кода.
Rate limit on-demand: 1 раз в 2 часа на компанию (проверяй перед вызовом).

### 10. Audit log — автоматически через PostgreSQL триггеры
Не добавляй ручную запись в `audit_logs` — триггер сделает это сам.
Исключения: таблицы без триггеров (`daily_activities`, `vacancy_snapshots`, `hh_manager_stats`).

---

## 🗄️ Таблицы БД (краткий справочник)

| Таблица | Назначение | Ключ |
|---------|-----------|------|
| `user_profiles` | Профили пользователей | `id = auth.users.id` |
| `vacancies` | Вакансии | `hh_vacancy_id` (nullable) |
| `vacancy_snapshots` | Снимки HH-воронки | `vacancy_id + snapshot_at` |
| `daily_activities` | Активности менеджера | UNIQUE `manager_id + activity_date` |
| `hired_employees` | Трудоустроенные из Sheets | `sheet_row_id` |
| `hr_manager_syncs` | Наши менеджеры (из Sheets) | `sheet_full_name` UNIQUE |
| `hr_bonuses` | Бонусы из Sheets | `sheet_row_id` |
| `hh_manager_stats` | Статистика из HH CSV | UNIQUE `manager_id + stat_date + source_csv` |
| `manager_plans` | Планы KPI | `manager_id + effective_from` |
| `staffing_records` | % укомплектованности | `recorded_at DESC` |
| `ai_insights` | AI-инсайты | `insight_type + period` |
| `sync_logs` | Журнал синхронизаций | `source + started_at` |
| `audit_logs` | Audit trail | `table_name + record_id` |
| `error_logs` | Ошибки приложения | `source + created_at` |

---

## 📊 KPI-формулы

```typescript
// Статус менеджера
const avg = (callsPct + interviewsPct + hiresPct) / 3;
// ≥90% → 'on_track' (зелёный) | 70–89% → 'behind' (жёлтый) | <70% → 'critical' (красный)

// Цвет ИВ
// ≥85 → зелёный | 70–84 → жёлтый | <70 → красный

// Итого звонков
const totalCalls = (mango_calls_count ?? 0) + (hh_calls_count ?? 0);

// Прогноз найма
const forecast = hiresFact + Math.round((hiresFact / workdaysPassed) * workdaysLeft);
```

---

## 🔄 Cron-расписание (Beget VPS)

| Скрипт | Расписание | Что делает |
|--------|-----------|-----------|
| `sync-hh.ts` | `0 8,10,12,14,16,18,20,22 * * 1-5` | HH API: воронка по вакансиям |
| `sync-mango.ts` | `0 20 * * 1-5` | Манго API: звонки по extension |
| `refresh-hh-tokens.ts` | `0 7 * * *` | Обновление HH OAuth токенов |
| `generate-weekly-report.ts` | `30 20 * * 5` | AI-анализ + еженедельный отчёт |

---

## 🎨 UI-стандарты

- **Тема:** светлая, Tailwind slate/gray
- **Toast:** `sonner` → `toast.success()` / `toast.error()`
- **Иконки:** `lucide-react` (конкретные указаны в SPEC.md Блок 4)
- **Skeleton:** всегда для Loading-состояния (не spinner кроме кнопок)
- **Empty state:** текст + иконка + CTA-кнопка
- **Error state:** `Alert` variant=destructive или `toast.error()`
- **Markdown:** `react-markdown` для AI-отчётов

---

## 🚀 Команды разработки

```bash
# Разработка
npm run dev

# Билд cron-скриптов (TypeScript → JavaScript)
npx tsc --project tsconfig.scripts.json

# Применить миграции Supabase
supabase db push

# Линтинг
npm run lint

# Деплой фронта (автоматически при push в main)
git push origin main
```

---

## ⚠️ Частые ошибки — не делай так

1. **НЕ** используй `supabase.auth.getSession()` на сервере — только `getUser()`
2. **НЕ** хардкоди роли или UUID — читай из БД
3. **НЕ** делай Anthropic API-вызовы в клиентском коде
4. **НЕ** передавай `SUPABASE_SERVICE_ROLE_KEY` в браузер
5. **НЕ** используй `localStorage` — данные сессии в httpOnly cookies
6. **НЕ** создавай вакансии без проверки роли head/admin
7. **НЕ** логируй 422 и 404 — это штатная работа, не ошибки
8. **НЕ** пиши деньги в рублях в БД — только копейки (INTEGER)
