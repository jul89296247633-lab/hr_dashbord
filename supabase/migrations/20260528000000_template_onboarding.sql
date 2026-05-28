-- ════════════════════════════════════════════════════════════════════════
-- 20260528000000_template_onboarding.sql
--
-- Онбординг через XLSX-шаблоны (FEATURE_SPEC_template_upload.md).
-- SPEC_RECONCILIATION §1: city не добавляется — используется vacancies.location.
--
-- Блок 1 — Data Model:
--   1. vacancies: +confidentiality (NOT NULL DEFAULT 'open'), +internal_ref.
--   2. template_uploads: история загрузок (аудит + idempotency по file_hash).
--
-- Целевые таблицы (vacancies, bonus_rates, hr_manager_syncs, staffing_plan,
-- user_profiles) — структура не меняется. API-apply пишет через service_role.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. vacancies: confidentiality + internal_ref ──────────────────────────

-- NOT NULL DEFAULT 'open': существующие 199 строк получают 'open' автоматически
-- (PostgreSQL 11+ выполняет fast column addition без перезаписи таблицы).
-- Конфиденциальная без hh_vacancy_id — норма; API генерит internal_ref (CONF-ГГГГ-NNNN).
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS confidentiality TEXT NOT NULL DEFAULT 'open'
    CHECK (confidentiality IN ('open', 'confidential'));

-- Внутренний уникальный ref конфиденциальных вакансий. Формат: CONF-ГГГГ-NNNN.
-- Генерируется API при upload с retry при UNIQUE violation (Block 2).
-- UNIQUE допускает несколько NULL — существующие строки не затрагиваются.
-- Каскад матчинга: hh_vacancy_id → internal_ref → INSERT.
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS internal_ref TEXT UNIQUE
    CHECK (internal_ref IS NULL OR char_length(internal_ref) <= 50);

-- ── 2. template_uploads ───────────────────────────────────────────────────
-- Запись создаётся при POST /api/templates/upload (pending → previewed).
-- Обновляется при apply: status='applied'|'failed', rows_* заполняются.
-- apply принимает только status='previewed'; иначе → UPLOAD_EXPIRED (409).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_uploads (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by   UUID    NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  template_type TEXT    NOT NULL
                          CHECK (template_type IN
                            ('data', 'bonus_rates', 'hr_list', 'staffing_plan', 'combined')),
  file_name     TEXT    NOT NULL
                          CHECK (char_length(file_name) BETWEEN 1 AND 255),
  -- sha256 hex-дайджест файла. Совпадение → предупреждение «файл уже загружался».
  -- NULL допускается: не блокирует загрузку если хеширование не выполнено.
  file_hash     TEXT,
  rows_total    INTEGER NOT NULL DEFAULT 0 CHECK (rows_total    >= 0),
  rows_inserted INTEGER NOT NULL DEFAULT 0 CHECK (rows_inserted >= 0),
  rows_updated  INTEGER NOT NULL DEFAULT 0 CHECK (rows_updated  >= 0),
  rows_skipped  INTEGER NOT NULL DEFAULT 0 CHECK (rows_skipped  >= 0),
  rows_error    INTEGER NOT NULL DEFAULT 0 CHECK (rows_error    >= 0),
  -- pending → previewed → applied | failed
  status        TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'previewed', 'applied', 'failed')),
  -- [{sheet, row, column, reason}] — ошибки/предупреждения парсинга.
  error_report  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_uploads_uploaded_by
  ON public.template_uploads(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_template_uploads_status
  ON public.template_uploads(status);
-- Быстрый поиск повторных загрузок того же содержимого.
CREATE INDEX IF NOT EXISTS idx_template_uploads_file_hash
  ON public.template_uploads(file_hash)
  WHERE file_hash IS NOT NULL;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.template_uploads ENABLE ROW LEVEL SECURITY;

-- SELECT: загрузчик видит свои; executive/head/admin — все записи.
DROP POLICY IF EXISTS "template_uploads_select" ON public.template_uploads;
CREATE POLICY "template_uploads_select" ON public.template_uploads
  FOR SELECT USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('executive', 'head', 'admin')
    )
  );

-- INSERT: создаёт запись при загрузке. uploaded_by = auth.uid() обязателен —
-- нельзя создать запись от чужого имени даже с правами admin.
DROP POLICY IF EXISTS "template_uploads_insert" ON public.template_uploads;
CREATE POLICY "template_uploads_insert" ON public.template_uploads
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- UPDATE: смена status + заполнение rows_* + error_report при preview/apply.
DROP POLICY IF EXISTS "template_uploads_update" ON public.template_uploads;
CREATE POLICY "template_uploads_update" ON public.template_uploads
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );
