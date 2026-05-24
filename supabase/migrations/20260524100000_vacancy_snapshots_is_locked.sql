-- ════════════════════════════════════════════════════════════════════════
-- 20260524100000_vacancy_snapshots_is_locked.sql
--
-- Фиксация исторических snapshots. Когда head/admin закрывает месяц
-- (PATCH /api/sync/lock-period?month=YYYY-MM), все его vacancy_snapshots
-- получают is_locked=true. После этого hh-csv sync для дней этого
-- периода пропускает запись (см. логику в /api/sync/hh-csv?type=vacancies).
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vacancy_snapshots
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — поможет быстрому lookup'у в hh-csv (для каждой строки CSV
-- проверяем: есть ли locked snapshot за этот день и эту вакансию).
CREATE INDEX IF NOT EXISTS idx_vacancy_snapshots_locked
  ON public.vacancy_snapshots (vacancy_id, snapshot_at)
  WHERE is_locked = TRUE;
