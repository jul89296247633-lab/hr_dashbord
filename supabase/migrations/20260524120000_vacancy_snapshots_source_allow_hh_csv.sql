-- ════════════════════════════════════════════════════════════════════════
-- 20260524120000_vacancy_snapshots_source_allow_hh_csv.sql
--
-- Изначальный CHECK constraint vacancy_snapshots_source_check разрешал только
-- {'hh_api','manual'}. Когда мы перешли на загрузку CSV (`source='hh_csv'`,
-- см. /api/sync/hh-csv?type=vacancies), все INSERT'ы тихо падали в
-- 23514 (check_violation). Расширяем constraint, чтобы 'hh_csv' проходил.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vacancy_snapshots
  DROP CONSTRAINT IF EXISTS vacancy_snapshots_source_check;

ALTER TABLE public.vacancy_snapshots
  ADD CONSTRAINT vacancy_snapshots_source_check
  CHECK (source IN ('hh_api', 'hh_csv', 'manual'));
