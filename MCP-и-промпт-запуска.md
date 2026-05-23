# MCP-команды и финальный промпт запуска

## 1. Подключение MCP-серверов

Выполни в терминале Claude Code (или VS Code интегрированный терминал):

```bash
# Supabase MCP — для работы с БД напрямую из Claude Code
claude mcp add supabase https://mcp.supabase.com/mcp

# Context7 MCP — актуальная документация Next.js, Supabase, shadcn/ui
claude mcp add context7 https://mcp.context7.com/mcp

# Vercel MCP — деплой и просмотр логов
claude mcp add vercel https://mcp.vercel.com
```

После подключения проверь:
```bash
claude mcp list
```

## 2. Настройка .env.local (создай в корне проекта)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google Sheets
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_VACANCIES_TAB=Вакансии
GOOGLE_SHEETS_MANAGERS_TAB=HR менеджеры
GOOGLE_SHEETS_BONUSES_TAB=Бонусы_HR
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
HH_CSV_ENCODING=windows-1251

# Telegram
TELEGRAM_BOT_TOKEN=7123456789:AAFxyz...
TELEGRAM_ADMIN_CHAT_ID=-1001234567890

# Anthropic AI
ANTHROPIC_API_KEY=sk-ant-api03-...
```

## 3. Финальный промпт для запуска Claude Code

Скопируй этот промпт целиком и вставь в Claude Code (VS Code):

---

```
Ты — ведущий разработчик проекта HR Control Tower. Прочитай CLAUDE.md и SPEC.md — это единственные источники истины.

ЗАДАЧА: Создай полную структуру проекта и начни реализацию в следующем порядке:

## ШАГ 1: Инициализация проекта
1. Создай Next.js 15 проект: `npx create-next-app@latest . --typescript --tailwind --app --src-dir=false`
2. Установи зависимости:
   ```
   npm install @supabase/ssr @supabase/supabase-js
   npm install @anthropic-ai/sdk
   npm install googleapis iconv-lite papaparse
   npm install zod sonner react-markdown lucide-react recharts
   npm install @anthropic-ai/sdk
   ```
3. Установи shadcn/ui: `npx shadcn@latest init` (выбери slate цвет, light theme)
4. Установи нужные shadcn компоненты:
   ```
   npx shadcn@latest add button card table badge input textarea select tabs sheet dialog alert skeleton progress collapsible tooltip
   ```

## ШАГ 2: Структура файлов
Создай структуру директорий как описана в CLAUDE.md (раздел "Структура проекта").

## ШАГ 3: Конфигурационные файлы
Создай:
- `middleware.ts` — защита роутов, redirect по роли из user_profiles
- `lib/supabase/server.ts` — серверный Supabase клиент
- `lib/supabase/client.ts` — браузерный Supabase клиент
- `lib/api-helpers.ts` — getAuthUser, requireRole, errorResponse, handleApiError, ApiError
- `lib/logger.ts` — logError() функция для записи в error_logs
- `types/index.ts` — TypeScript интерфейсы для всех сущностей из SPEC.md
- `lib/kpi.ts` — calcForecast, getManagerStatus, countWorkdays
- `lib/utils.ts` — formatMoney, formatPct, formatDate, getInitials, parseSheetDate

## ШАГ 4: База данных (Supabase миграции)
Создай `supabase/migrations/` с SQL из SPEC.md Блок 2. Порядок:
1. `001_extensions.sql` — pgcrypto, moddatetime, pg_trgm
2. `002_user_profiles.sql` — таблица + триггер создания профиля
3. `003_vacancies.sql` — таблица + индексы + RLS
4. `004_vacancy_snapshots.sql`
5. `005_daily_activities.sql`
6. `006_hired_employees.sql`
7. `007_hr_manager_syncs.sql`
8. `008_hr_bonuses.sql`
9. `009_hh_manager_stats.sql`
10. `010_manager_plans.sql`
11. `011_staffing_records.sql`
12. `012_ai_insights.sql`
13. `013_sync_logs.sql`
14. `014_audit_logs.sql` — включая функцию audit_trigger_fn() и все триггеры
15. `015_error_logs.sql`
16. `016_functions.sql` — fuzzy_match_vacancy RPC функция

## ШАГ 5: Sidebar и Layout
Создай:
- `components/layout/Sidebar.tsx` — навигация по ролям из CLAUDE.md
- `app/(auth)/layout.tsx` — без sidebar
- `app/(app)/layout.tsx` — с sidebar 240px

## ШАГ 6: Страница входа
Создай `app/(auth)/login/page.tsx` — форма login по email+password через Supabase Auth.

## ШАГ 7: Личный кабинет менеджера (приоритет #1)
Реализуй `/cabinet` — самый используемый экран:
- `app/(app)/cabinet/page.tsx`
- `app/(app)/cabinet/[date]/page.tsx`
- `app/api/activities/route.ts` (GET, POST)
- `app/api/activities/[date]/route.ts` (GET)
Смотри SPEC.md Блок 1 US-001, Блок 3 GROUP:Activities, Блок 4 Экран Кабинет менеджера.

## ШАГ 8: Cron-скрипты (базовые)
Создай `scripts/` с заготовками:
- `sync-hh.ts` — синхронизация HH API
- `sync-mango.ts` — синхронизация Манго
- `refresh-hh-tokens.ts` — обновление токенов

## Правила работы:
- Читай SPEC.md перед каждой задачей — там все детали
- Используй агентов из .claude/agents/ для специализированных задач
- Соблюдай rules из .claude/rules/
- После каждого шага сообщай что сделано и что следующее
- Если что-то неясно — спроси, не предполагай

Начни с ШАГ 1 и двигайся последовательно.
```

---

## 4. Команды для повседневной работы в Claude Code

```bash
# Создать новую страницу
"Создай страницу /dashboard/efficiency согласно SPEC.md Блок 4 Экран Эффективность"

# Создать API endpoint
"Создай API endpoint GET /api/stats/politeness согласно SPEC.md Блок 3 GROUP:Stats"

# Создать SQL миграцию
"Создай миграцию для таблицы ai_insights согласно SPEC.md Блок 2 Таблица ai_insights"

# Исправить ошибку
"В error_logs есть ошибка MANGO_TIMEOUT в sync-mango.ts — проверь и исправь retry логику"

# Делегировать специалисту
"Используй агента database для создания RLS политик на таблице hr_bonuses"
"Используй агента ai-analyst для реализации генерации аномалий"
```

## 5. Структура финального проекта для Claude Code

```
hr-control-tower/
├── CLAUDE.md                          ← главный файл (уже создан)
├── SPEC.md                            ← скопировать сюда
├── .claude/
│   ├── agents/
│   │   ├── database.md
│   │   ├── api.md
│   │   ├── frontend.md
│   │   ├── integrations.md
│   │   └── ai-analyst.md
│   └── rules/
│       ├── typescript.md
│       ├── supabase.md
│       ├── ui.md
│       ├── security.md
│       └── ai-agents.md
├── .env.local                         ← создать вручную (не коммитить)
└── ... (всё остальное создаст Claude Code)
```
