-- ── 20260523150000_vacancies_sheets_fields.sql ────────────────────────────
-- Расширение `vacancies` под маппинг из листа Google Sheets «Data»
-- (новая архитектура: Sheets — источник истины по вакансиям).
--
-- Поля nullable: исторические вакансии (созданные через UI до перехода
-- на Sheets-sync) не имеют этих данных, и это нормально.
--   - location          ← «Населённый пункт» (B)
--   - positions_count   ← «Кол-во» (J), DEFAULT 1 (если в листе пусто)
--   - customer_name     ← «ФИО Заказчика» (H)

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS location        TEXT,
  ADD COLUMN IF NOT EXISTS positions_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS customer_name   TEXT;
