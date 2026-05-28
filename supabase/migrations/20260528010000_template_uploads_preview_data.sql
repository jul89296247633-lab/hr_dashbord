-- ════════════════════════════════════════════════════════════════════════
-- 20260528010000_template_uploads_preview_data.sql
--
-- Добавляет колонку preview_data в template_uploads.
-- Хранит распарсенные, валидированные строки между upload (preview)
-- и apply: без этого apply не знает какие строки применять.
--
-- Структура: { data?: row[], bonus_rates?: row[], hr_list?: row[],
--              staffing_plan?: row[] } — по одному массиву на тип листа.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.template_uploads
  ADD COLUMN IF NOT EXISTS preview_data JSONB NOT NULL DEFAULT '{}'::JSONB;
