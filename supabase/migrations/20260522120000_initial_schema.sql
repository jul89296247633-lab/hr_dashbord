-- ════════════════════════════════════════════════════════════════════════
-- 20260522120000_initial_schema.sql
-- HR Control Tower — начальная схема БД (SPEC Блок 2)
--
-- Единая идемпотентная миграция. Порядок секций:
--   1. EXTENSIONS
--   2. TABLES (+ индексы каждой таблицы рядом)
--   3. RLS (ENABLE + политики)
--   4. TRIGGERS / FUNCTIONS (moddatetime, handle_new_user, audit, RPC fuzzy-match)
--
-- RLS включён на ВСЕХ таблицах. service_role (cron/sync) обходит RLS.
-- Деньги — только в копейках (INTEGER). Применение: `supabase db push`.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- 1. EXTENSIONS (SPEC Блок 2, Шаг 0)
-- ════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS moddatetime;  -- триггер updated_at
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy match по названию должности


-- ════════════════════════════════════════════════════════════════════════
-- 2. TABLES
-- ════════════════════════════════════════════════════════════════════════

-- ── user_profiles ─────────────────────────────────────────────────────────
-- Профили пользователей. id = auth.users.id (Supabase Auth).
-- Создаётся автоматически через trigger handle_new_user при регистрации.
CREATE TABLE IF NOT EXISTS public.user_profiles (
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
  -- Добавочный номер в Манго ВАТС. По нему фильтруем историю через vpbx/stats/request.
  -- NULL если менеджер не использует Манго (звонит только через HH).
  mango_extension      TEXT CHECK (mango_extension ~ '^\d{2,6}$' OR mango_extension IS NULL),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role   ON public.user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON public.user_profiles(is_active)
  WHERE is_active = TRUE;


-- ── vacancies ─────────────────────────────────────────────────────────────
-- Вакансии HR-отдела. Один ответственный менеджер на вакансию.
CREATE TABLE IF NOT EXISTS public.vacancies (
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

CREATE INDEX IF NOT EXISTS idx_vacancies_manager_id ON public.vacancies(manager_id);
CREATE INDEX IF NOT EXISTS idx_vacancies_status     ON public.vacancies(status);
CREATE INDEX IF NOT EXISTS idx_vacancies_hh_id      ON public.vacancies(hh_vacancy_id)
  WHERE hh_vacancy_id IS NOT NULL;
-- Для fuzzy-match по названию при Google Sheets-синхронизации
CREATE INDEX IF NOT EXISTS idx_vacancies_title_trgm ON public.vacancies USING gin(title gin_trgm_ops);


-- ── vacancy_snapshots ─────────────────────────────────────────────────────
-- Снимки статистики HH.ru по вакансии. Только INSERT — иммутабельны.
-- Для актуальных данных берётся последний snapshot по snapshot_at DESC.
CREATE TABLE IF NOT EXISTS public.vacancy_snapshots (
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

CREATE INDEX IF NOT EXISTS idx_snapshots_vacancy_id ON public.vacancy_snapshots(vacancy_id);
-- DESC для быстрого получения последнего snapshot
CREATE INDEX IF NOT EXISTS idx_snapshots_at_desc    ON public.vacancy_snapshots(vacancy_id, snapshot_at DESC);


-- ── daily_activities ──────────────────────────────────────────────────────
-- Ежедневные активности HR-менеджера.
-- UNIQUE(manager_id, activity_date) — одна запись на менеджера в день (upsert).
CREATE TABLE IF NOT EXISTS public.daily_activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id           UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  activity_date        DATE NOT NULL,

  -- === ЗВОНКИ ===
  -- Источник 1: Манго ВАТС API — cron в 20:00, vpbx/stats/request по extension менеджера.
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

CREATE INDEX IF NOT EXISTS idx_activities_manager_id   ON public.daily_activities(manager_id);
CREATE INDEX IF NOT EXISTS idx_activities_date_desc    ON public.daily_activities(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_manager_date ON public.daily_activities(manager_id, activity_date DESC);


-- ── hired_employees ───────────────────────────────────────────────────────
-- Закрытые вакансии с трудоустройством. Источник: Google Sheets.
-- Условие импорта: «Статус» = «закрыта» AND «Дата закрытия» заполнена.
-- sheet_row_id — номер строки в Google Sheets, ключ для idempotent upsert.
CREATE TABLE IF NOT EXISTS public.hired_employees (
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
  employment_type   TEXT NOT NULL DEFAULT 'employee'
                      CHECK (employment_type IN ('employee', 'intern')),
  -- ФИО менеджера из Sheets (для привязки бонуса если vacancy_id = NULL)
  manager_name_sheet TEXT CHECK (char_length(manager_name_sheet) <= 100),
  -- Timestamp последней синхронизации из Sheets
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hired_vacancy_id ON public.hired_employees(vacancy_id);
CREATE INDEX IF NOT EXISTS idx_hired_date_desc  ON public.hired_employees(hired_date DESC);
CREATE INDEX IF NOT EXISTS idx_hired_synced_at  ON public.hired_employees(synced_at DESC);


-- ── ai_insights ───────────────────────────────────────────────────────────
-- Результаты AI-анализа: аномалии, прогнозы, рекомендации, еженедельные отчёты.
-- Генерируются cron (еженедельно) и on-demand. Только INSERT.
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_type    TEXT NOT NULL
                    CHECK (insight_type IN (
                      'anomaly',        -- аномалия активности менеджера
                      'forecast',       -- прогноз выполнения плана
                      'recommendation', -- рекомендация по воронке вакансии
                      'weekly_report'   -- еженедельный отчёт руководителю
                    )),
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
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Токены потраченные на генерацию (для мониторинга стоимости)
  tokens_used     INTEGER,
  -- Кто запустил: 'cron' или UUID пользователя
  triggered_by    TEXT NOT NULL DEFAULT 'cron',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_type       ON public.ai_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_insights_manager_id ON public.ai_insights(manager_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_vacancy_id ON public.ai_insights(vacancy_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_created_at ON public.ai_insights(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_unread     ON public.ai_insights(is_read) WHERE is_read = FALSE;


-- ── hr_manager_syncs ──────────────────────────────────────────────────────
-- Список действующих HR-менеджеров из листа «HR менеджеры» Google Sheets.
-- КЛЮЧЕВОЕ ПРАВИЛО: единственный список «своих» менеджеров. При загрузке любого
-- CSV из HH в анализ берутся ТОЛЬКО менеджеры, чьё имя есть здесь (sheet_full_name).
CREATE TABLE IF NOT EXISTS public.hr_manager_syncs (
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

CREATE INDEX IF NOT EXISTS idx_hr_sync_user_id ON public.hr_manager_syncs(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_hr_sync_name    ON public.hr_manager_syncs(sheet_full_name);


-- ── hr_bonuses ────────────────────────────────────────────────────────────
-- Бонусы HR-менеджеров из листа «Бонусы_HR» Google Sheets.
-- Сопоставление: vacancy_title → vacancies.title (fuzzy 0.8);
--                manager_name  → hr_manager_syncs.sheet_full_name (точное).
CREATE TABLE IF NOT EXISTS public.hr_bonuses (
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
  -- Сумма бонуса в копейках (INTEGER). Пример: 50000 руб. → 5000000 копеек
  bonus_amount_kopecks INTEGER NOT NULL CHECK (bonus_amount_kopecks >= 0),
  bonus_date          DATE NOT NULL,
  -- Статус: 'pending' = начислен, 'paid' = выплачен
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid')),
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonuses_manager_id ON public.hr_bonuses(manager_id);
CREATE INDEX IF NOT EXISTS idx_bonuses_vacancy_id ON public.hr_bonuses(vacancy_id);
CREATE INDEX IF NOT EXISTS idx_bonuses_date_desc  ON public.hr_bonuses(bonus_date DESC);
CREATE INDEX IF NOT EXISTS idx_bonuses_status     ON public.hr_bonuses(status);


-- ── hh_manager_stats ──────────────────────────────────────────────────────
-- Статистика по менеджерам из CSV-выгрузок HH «Аналитика подбора».
-- Источники: «Звонки», «Индекс вежливости менеджеров», «Индекс вежливости компании».
-- Для ИВ компании: manager_id = NULL, stat_date = дата отчёта.
CREATE TABLE IF NOT EXISTS public.hh_manager_stats (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = строка относится к компании в целом (индекс вежливости компании)
  manager_id          UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  -- Имя менеджера из CSV (для сопоставления если manager_id не найден)
  manager_name_hh     TEXT CHECK (char_length(manager_name_hh) <= 100),
  stat_date           DATE NOT NULL,

  -- === ИЗ CSV «ЗВОНКИ» ===
  hh_calls_count      INTEGER CHECK (hh_calls_count >= 0),

  -- === ИЗ CSV «ИНДЕКС ВЕЖЛИВОСТИ МЕНЕДЖЕРОВ» ===
  responses_received  INTEGER CHECK (responses_received >= 0),
  responses_viewed    INTEGER CHECK (responses_viewed >= 0),
  responses_answered  INTEGER CHECK (responses_answered >= 0),
  -- Индекс вежливости: 0–100 (для manager_id = NULL → индекс вежливости компании)
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

CREATE INDEX IF NOT EXISTS idx_hh_stats_manager_id ON public.hh_manager_stats(manager_id);
CREATE INDEX IF NOT EXISTS idx_hh_stats_date_desc  ON public.hh_manager_stats(stat_date DESC);
CREATE INDEX IF NOT EXISTS idx_hh_stats_company    ON public.hh_manager_stats(stat_date DESC) WHERE manager_id IS NULL;


-- ── manager_plans ─────────────────────────────────────────────────────────
-- Планы KPI по менеджеру. При изменении — INSERT новой записи (старая остаётся).
-- Активный план = последняя запись WHERE manager_id = X AND effective_from <= CURRENT_DATE.
CREATE TABLE IF NOT EXISTS public.manager_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id          UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  -- План: 15 звонков в день (через встроенные звонки HH.ru).
  calls_per_day       INTEGER NOT NULL DEFAULT 15 CHECK (calls_per_day BETWEEN 0 AND 200),
  -- План: 5 собеседований в день (ручной ввод менеджера).
  interviews_per_day  INTEGER NOT NULL DEFAULT 5  CHECK (interviews_per_day BETWEEN 0 AND 50),
  -- План: 15 закрытых вакансий в месяц.
  hires_per_month     INTEGER NOT NULL DEFAULT 15 CHECK (hires_per_month BETWEEN 0 AND 100),
  -- Лимит вакансий одного менеджера одновременно.
  vacancies_limit     INTEGER NOT NULL DEFAULT 5  CHECK (vacancies_limit BETWEEN 0 AND 100),
  set_by              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Нет updated_at: план не редактируется, только добавляется новая версия
);

CREATE INDEX IF NOT EXISTS idx_plans_manager_id     ON public.manager_plans(manager_id);
CREATE INDEX IF NOT EXISTS idx_plans_effective_from ON public.manager_plans(manager_id, effective_from DESC);


-- ── staffing_records ──────────────────────────────────────────────────────
-- История % укомплектованности. Вносится вручную руководителем. INSERT-only.
CREATE TABLE IF NOT EXISTS public.staffing_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staffing_pct  INTEGER NOT NULL CHECK (staffing_pct BETWEEN 0 AND 100),
  comment       TEXT CHECK (char_length(comment) <= 500),
  recorded_by   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Нет updated_at: запись не редактируется, только добавляется новая
);

CREATE INDEX IF NOT EXISTS idx_staffing_recorded_at ON public.staffing_records(recorded_at DESC);


-- ── sync_logs ─────────────────────────────────────────────────────────────
-- Журнал синхронизаций (HH API cron, HH CSV upload, Google Sheets, Манго).
CREATE TABLE IF NOT EXISTS public.sync_logs (
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
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_source  ON public.sync_logs(source);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON public.sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status  ON public.sync_logs(status);


-- ── audit_logs ────────────────────────────────────────────────────────────
-- Audit trail: кто, когда и что изменил. Только INSERT через триггер audit_trigger_fn.
CREATE TABLE IF NOT EXISTS public.audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_audit_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id      ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at   ON public.audit_logs(created_at DESC);
-- Для поиска всех изменений за период
CREATE INDEX IF NOT EXISTS idx_audit_created_date ON public.audit_logs(created_at DESC)
  WHERE action IN ('UPDATE', 'DELETE');


-- ── error_logs ────────────────────────────────────────────────────────────
-- Журнал ошибок приложения: упавшие API, cron-скрипты, исключения. INSERT-only.
-- Хранятся 90 дней, затем удаляются (pg_cron или внешний cleanup).
CREATE TABLE IF NOT EXISTS public.error_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source         TEXT NOT NULL CHECK (source IN (
    'api',          -- Next.js API route
    'cron_hh',      -- cron sync-hh.ts
    'cron_mango',   -- cron sync-mango.ts
    'cron_ai',      -- cron generate-weekly-report.ts
    'sync_sheets',  -- синхронизация Google Sheets
    'hh_csv_upload',-- загрузка CSV из HH
    'client'        -- фронтенд (необработанные ошибки JS)
  )),
  severity       TEXT NOT NULL DEFAULT 'error'
                   CHECK (severity IN ('warning', 'error', 'critical')),
  -- Код ошибки (машинночитаемый, для фильтрации)
  error_code     TEXT CHECK (char_length(error_code) <= 100),
  message        TEXT NOT NULL CHECK (char_length(message) <= 2000),
  stack_trace    TEXT CHECK (char_length(stack_trace) <= 10000),
  -- Контекст: что делал пользователь / скрипт (JSON)
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

CREATE INDEX IF NOT EXISTS idx_error_source     ON public.error_logs(source);
CREATE INDEX IF NOT EXISTS idx_error_severity   ON public.error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_created_at ON public.error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_unresolved ON public.error_logs(resolved, created_at DESC)
  WHERE resolved = FALSE;


-- ════════════════════════════════════════════════════════════════════════
-- 3. RLS (ENABLE + политики). RLS включён на ВСЕХ таблицах.
-- service_role (cron/sync) обходит RLS — политики WITH CHECK (TRUE) для записи.
-- ════════════════════════════════════════════════════════════════════════

-- ── user_profiles ─────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Каждый видит свой профиль. head/admin видят все профили.
DROP POLICY IF EXISTS "profiles_select" ON public.user_profiles;
CREATE POLICY "profiles_select" ON public.user_profiles
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Пользователь обновляет только свой профиль (имя, расширение).
DROP POLICY IF EXISTS "profiles_update_own" ON public.user_profiles;
CREATE POLICY "profiles_update_own" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin управляет всеми профилями.
DROP POLICY IF EXISTS "profiles_admin_all" ON public.user_profiles;
CREATE POLICY "profiles_admin_all" ON public.user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

-- ── vacancies ─────────────────────────────────────────────────────────────
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;

-- manager видит только свои; head/admin/executive — все
DROP POLICY IF EXISTS "vacancies_select" ON public.vacancies;
CREATE POLICY "vacancies_select" ON public.vacancies
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
    )
  );

-- head/admin создают и редактируют вакансии
DROP POLICY IF EXISTS "vacancies_write" ON public.vacancies;
CREATE POLICY "vacancies_write" ON public.vacancies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- ── vacancy_snapshots ─────────────────────────────────────────────────────
ALTER TABLE public.vacancy_snapshots ENABLE ROW LEVEL SECURITY;

-- Читают те же роли, что видят вакансию
DROP POLICY IF EXISTS "snapshots_select" ON public.vacancy_snapshots;
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

-- INSERT только через service_role (cron и API через SUPABASE_SERVICE_ROLE_KEY)
DROP POLICY IF EXISTS "snapshots_service_insert" ON public.vacancy_snapshots;
CREATE POLICY "snapshots_service_insert" ON public.vacancy_snapshots
  FOR INSERT WITH CHECK (TRUE);

-- ── daily_activities ──────────────────────────────────────────────────────
ALTER TABLE public.daily_activities ENABLE ROW LEVEL SECURITY;

-- Менеджер управляет только своими записями
DROP POLICY IF EXISTS "activities_manager_own" ON public.daily_activities;
CREATE POLICY "activities_manager_own" ON public.daily_activities
  FOR ALL
  USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());

-- head/admin читают все активности (для дашборда)
DROP POLICY IF EXISTS "activities_head_select" ON public.daily_activities;
CREATE POLICY "activities_head_select" ON public.daily_activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- service_role (cron HH) обновляет hh_calls_count
DROP POLICY IF EXISTS "activities_service_upsert" ON public.daily_activities;
CREATE POLICY "activities_service_upsert" ON public.daily_activities
  FOR ALL WITH CHECK (TRUE);

-- ── hired_employees ───────────────────────────────────────────────────────
ALTER TABLE public.hired_employees ENABLE ROW LEVEL SECURITY;

-- manager видит только тех, кто привязан к его вакансиям
DROP POLICY IF EXISTS "hired_select" ON public.hired_employees;
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
DROP POLICY IF EXISTS "hired_service_write" ON public.hired_employees;
CREATE POLICY "hired_service_write" ON public.hired_employees
  FOR ALL WITH CHECK (TRUE);

-- ── ai_insights ───────────────────────────────────────────────────────────
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только инсайты о себе; head/admin — все; weekly_report (manager_id NULL) — head/admin
DROP POLICY IF EXISTS "ai_insights_manager_own" ON public.ai_insights;
CREATE POLICY "ai_insights_manager_own" ON public.ai_insights
  FOR SELECT USING (
    manager_id = auth.uid()
    OR manager_id IS NULL
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
DROP POLICY IF EXISTS "ai_insights_service_write" ON public.ai_insights;
CREATE POLICY "ai_insights_service_write" ON public.ai_insights
  FOR ALL WITH CHECK (TRUE);

-- ── hr_manager_syncs ──────────────────────────────────────────────────────
ALTER TABLE public.hr_manager_syncs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_syncs_head_select" ON public.hr_manager_syncs;
CREATE POLICY "hr_syncs_head_select" ON public.hr_manager_syncs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
DROP POLICY IF EXISTS "hr_syncs_service_write" ON public.hr_manager_syncs;
CREATE POLICY "hr_syncs_service_write" ON public.hr_manager_syncs
  FOR ALL WITH CHECK (TRUE);

-- ── hr_bonuses ────────────────────────────────────────────────────────────
ALTER TABLE public.hr_bonuses ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только свои бонусы
DROP POLICY IF EXISTS "bonuses_manager_own" ON public.hr_bonuses;
CREATE POLICY "bonuses_manager_own" ON public.hr_bonuses
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
DROP POLICY IF EXISTS "bonuses_service_write" ON public.hr_bonuses;
CREATE POLICY "bonuses_service_write" ON public.hr_bonuses
  FOR ALL WITH CHECK (TRUE);

-- ── hh_manager_stats ──────────────────────────────────────────────────────
ALTER TABLE public.hh_manager_stats ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только свои строки; ИВ компании (manager_id=NULL) — все авторизованные
DROP POLICY IF EXISTS "hh_stats_manager_own" ON public.hh_manager_stats;
CREATE POLICY "hh_stats_manager_own" ON public.hh_manager_stats
  FOR SELECT USING (
    manager_id = auth.uid()
    OR manager_id IS NULL
    OR EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role IN ('head','admin'))
  );
DROP POLICY IF EXISTS "hh_stats_service_write" ON public.hh_manager_stats;
CREATE POLICY "hh_stats_service_write" ON public.hh_manager_stats
  FOR ALL WITH CHECK (TRUE);

-- ── manager_plans ─────────────────────────────────────────────────────────
ALTER TABLE public.manager_plans ENABLE ROW LEVEL SECURITY;

-- Менеджер читает свой план
DROP POLICY IF EXISTS "plans_manager_select" ON public.manager_plans;
CREATE POLICY "plans_manager_select" ON public.manager_plans
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Только head/admin создают планы
DROP POLICY IF EXISTS "plans_head_insert" ON public.manager_plans;
CREATE POLICY "plans_head_insert" ON public.manager_plans
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- ── staffing_records ──────────────────────────────────────────────────────
ALTER TABLE public.staffing_records ENABLE ROW LEVEL SECURITY;

-- Все авторизованные видят (% укомплектованности — мотивационный элемент)
DROP POLICY IF EXISTS "staffing_select_all" ON public.staffing_records;
CREATE POLICY "staffing_select_all" ON public.staffing_records
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Только head/admin создают
DROP POLICY IF EXISTS "staffing_insert_head" ON public.staffing_records;
CREATE POLICY "staffing_insert_head" ON public.staffing_records
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- ── sync_logs ─────────────────────────────────────────────────────────────
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_logs_select" ON public.sync_logs;
CREATE POLICY "sync_logs_select" ON public.sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Пишут и обновляют только cron и API-эндпоинты через service_role
DROP POLICY IF EXISTS "sync_logs_service_all" ON public.sync_logs;
CREATE POLICY "sync_logs_service_all" ON public.sync_logs
  FOR ALL WITH CHECK (TRUE);

-- ── audit_logs ────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Только admin читает audit logs
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
-- Пишет только service_role (триггерные функции)
DROP POLICY IF EXISTS "audit_logs_service_write" ON public.audit_logs;
CREATE POLICY "audit_logs_service_write" ON public.audit_logs
  FOR INSERT WITH CHECK (TRUE);

-- ── error_logs ────────────────────────────────────────────────────────────
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Только admin читает и управляет error_logs
DROP POLICY IF EXISTS "error_logs_admin" ON public.error_logs;
CREATE POLICY "error_logs_admin" ON public.error_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id = auth.uid() AND u.role = 'admin')
  );
-- service_role пишет (cron + API через SUPABASE_SERVICE_ROLE_KEY)
DROP POLICY IF EXISTS "error_logs_service_write" ON public.error_logs;
CREATE POLICY "error_logs_service_write" ON public.error_logs
  FOR INSERT WITH CHECK (TRUE);


-- ════════════════════════════════════════════════════════════════════════
-- 4. TRIGGERS / FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════

-- ── moddatetime(updated_at) на таблицах с updated_at ──────────────────────
DROP TRIGGER IF EXISTS user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS vacancies_updated_at ON public.vacancies;
CREATE TRIGGER vacancies_updated_at
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS daily_activities_updated_at ON public.daily_activities;
CREATE TRIGGER daily_activities_updated_at
  BEFORE UPDATE ON public.daily_activities
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS hired_employees_updated_at ON public.hired_employees;
CREATE TRIGGER hired_employees_updated_at
  BEFORE UPDATE ON public.hired_employees
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS hr_manager_syncs_updated_at ON public.hr_manager_syncs;
CREATE TRIGGER hr_manager_syncs_updated_at
  BEFORE UPDATE ON public.hr_manager_syncs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS hr_bonuses_updated_at ON public.hr_bonuses;
CREATE TRIGGER hr_bonuses_updated_at
  BEFORE UPDATE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

DROP TRIGGER IF EXISTS hh_manager_stats_updated_at ON public.hh_manager_stats;
CREATE TRIGGER hh_manager_stats_updated_at
  BEFORE UPDATE ON public.hh_manager_stats
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── handle_new_user: создать профиль при регистрации через Supabase Auth ──
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── audit_trigger_fn: автоматическая запись в audit_logs ──────────────────
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
    -- Сохраняем только изменившиеся поля
    SELECT jsonb_object_agg(key, value) INTO v_old
    FROM jsonb_each(to_jsonb(OLD))
    WHERE value IS DISTINCT FROM (to_jsonb(NEW))->key;

    SELECT jsonb_object_agg(key, value) INTO v_new
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

-- Подключение audit-триггеров к ключевым таблицам.
-- НЕ логируются: daily_activities, vacancy_snapshots, hh_manager_stats (по SPEC).
DROP TRIGGER IF EXISTS audit_user_profiles ON public.user_profiles;
CREATE TRIGGER audit_user_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_vacancies ON public.vacancies;
CREATE TRIGGER audit_vacancies
  AFTER INSERT OR UPDATE OR DELETE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_manager_plans ON public.manager_plans;
CREATE TRIGGER audit_manager_plans
  AFTER INSERT OR UPDATE OR DELETE ON public.manager_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_staffing_records ON public.staffing_records;
CREATE TRIGGER audit_staffing_records
  AFTER INSERT OR DELETE ON public.staffing_records
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_hired_employees ON public.hired_employees;
CREATE TRIGGER audit_hired_employees
  AFTER INSERT OR UPDATE OR DELETE ON public.hired_employees
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_hr_bonuses ON public.hr_bonuses;
CREATE TRIGGER audit_hr_bonuses
  AFTER INSERT OR UPDATE OR DELETE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ── RPC fuzzy-match для синхронизации Google Sheets ───────────────────────
-- fuzzy_match_vacancy — возвращает лучший кандидат с similarity_score (SPEC §5.6)
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

-- find_vacancy_by_title — возвращает только id активной вакансии (SPEC §5.6b)
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
