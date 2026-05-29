-- ════════════════════════════════════════════════════════════════════════
-- 20260529020000_hr_manager_syncs_hh_id_full_index.sql
--
-- Заменяем partial unique index на full unique index, чтобы
-- ON CONFLICT (hh_manager_id) в upsert корректно разрешался PostgreSQL.
--
-- Проблема: ON CONFLICT (column) работает только с non-partial unique
-- index / constraint. При partial index (WHERE hh_manager_id IS NOT NULL)
-- PostgreSQL не может найти matching index без явного WHERE в conflict target,
-- а supabase-js не поддерживает WHERE в onConflict.
--
-- Поведение идентично: PostgreSQL допускает множественные NULL в unique index
-- (NULL != NULL), поэтому full index ≡ partial WHERE IS NOT NULL по факту.
-- ════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_hr_manager_syncs_hh_manager_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_manager_syncs_hh_manager_id
  ON public.hr_manager_syncs (hh_manager_id);
