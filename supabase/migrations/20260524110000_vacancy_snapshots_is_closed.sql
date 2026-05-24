-- ════════════════════════════════════════════════════════════════════════
-- 20260524110000_vacancy_snapshots_is_closed.sql
--
-- Поле «Закрытая» = «Да» из CSV recruitment_analytics_vacancies_*.csv.
-- KPI «Закрыто вакансий» на /dashboard теперь считает COUNT(DISTINCT
-- vacancy_id) из snapshots WHERE is_closed=TRUE для выбранного месяца —
-- источник истины переезжает с vacancies.closed_at (Sheets) на HH CSV.
--
-- Partial index ускоряет фильтр в /api/dashboard/team.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vacancy_snapshots
  ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vacancy_snapshots_is_closed
  ON public.vacancy_snapshots (vacancy_id, snapshot_at)
  WHERE is_closed = TRUE;
