-- ── 20260523140000_vacancy_snapshots_unique_per_day.sql ───────────────────
-- Разовая дедупликация `vacancy_snapshots`: для каждой пары (vacancy_id, день)
-- оставляем самую свежую запись (по snapshot_at DESC, затем created_at DESC).
--
-- DB-уровневого UNIQUE-индекса/constraint сознательно НЕ создаём:
--   - выражение `(snapshot_at::date)` нельзя использовать через
--     supabase-js `.upsert(onConflict: ...)`;
--   - добавлять отдельную колонку `snapshot_date DATE` ради этого избыточно.
-- Идемпотентность гарантирует роут /api/sync/hh-csv: DELETE-за-день + INSERT.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vacancy_id, DATE(snapshot_at)
           ORDER BY snapshot_at DESC, created_at DESC
         ) AS rn
  FROM public.vacancy_snapshots
)
DELETE FROM public.vacancy_snapshots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
