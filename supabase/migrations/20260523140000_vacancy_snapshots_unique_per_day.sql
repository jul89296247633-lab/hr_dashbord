-- ── 20260523140000_vacancy_snapshots_unique_per_day.sql ───────────────────
-- Идемпотентность загрузки CSV «Аналитика вакансий»: одна запись
-- snapshot за день на вакансию. Защищает от дублей при повторной загрузке
-- одного и того же CSV (например, после ошибки или ручной перезаливки).
--
-- Перед созданием индекса дедуплицируем существующие строки: для каждой
-- пары (vacancy_id, день) оставляем самую свежую (по snapshot_at DESC,
-- затем created_at DESC). Без этой чистки CREATE UNIQUE INDEX упал бы
-- на исторических данных.
--
-- ВНИМАНИЕ: индекс на **выражении** (snapshot_at::date), поэтому
-- supabase-js .upsert(..., onConflict:'vacancy_id,snapshot_at') его НЕ
-- увидит. В роуте /api/sync/hh-csv используем DELETE-за-день + INSERT.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY vacancy_id, (snapshot_at::date)
           ORDER BY snapshot_at DESC, created_at DESC
         ) AS rn
  FROM public.vacancy_snapshots
)
DELETE FROM public.vacancy_snapshots
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vacancy_snapshots_vacancy_day_unique
  ON public.vacancy_snapshots (vacancy_id, (snapshot_at::date));
