-- ════════════════════════════════════════════════════════════════════════
-- 20260527000000_staffing_plan.sql
--
-- Штатное расписание (Staffing Plan) — план единиц по городам и должностям.
-- НЕ путать со staffing_records («% укомплектованности», ручной общий
-- процент). Это две независимые сущности — см. FEATURE_SPEC_staffing_plan.md
-- и SPEC_RECONCILIATION.md.
--
-- Заполненность (occupied / in_progress / vacant) считается на лету в API,
-- НЕ хранится в таблице.
--
-- Город матчится с vacancies.location (одинаковое написание).
-- Должность матчится с bonus_rates.position_name (единая номенклатура).
-- ════════════════════════════════════════════════════════════════════════

-- ── Таблица ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staffing_plan (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city           TEXT NOT NULL
                   CHECK (char_length(city) BETWEEN 2 AND 100),
  position_name  TEXT NOT NULL
                   CHECK (char_length(position_name) BETWEEN 2 AND 200),
  planned_units  INTEGER NOT NULL
                   CHECK (planned_units BETWEEN 0 AND 999),
  comment        TEXT
                   CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_by     UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (city, position_name)
);

CREATE INDEX IF NOT EXISTS idx_staffing_plan_city
  ON public.staffing_plan(city);
CREATE INDEX IF NOT EXISTS idx_staffing_plan_position
  ON public.staffing_plan(position_name);

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.staffing_plan ENABLE ROW LEVEL SECURITY;

-- Чтение: всем авторизованным (план — мотивационный/прозрачный документ,
-- как и staffing_records).
DROP POLICY IF EXISTS "staffing_plan_select_all" ON public.staffing_plan;
CREATE POLICY "staffing_plan_select_all" ON public.staffing_plan
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Запись: только head/admin (стиль EXISTS — как в проекте).
DROP POLICY IF EXISTS "staffing_plan_insert_head" ON public.staffing_plan;
CREATE POLICY "staffing_plan_insert_head" ON public.staffing_plan
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

DROP POLICY IF EXISTS "staffing_plan_update_head" ON public.staffing_plan;
CREATE POLICY "staffing_plan_update_head" ON public.staffing_plan
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

DROP POLICY IF EXISTS "staffing_plan_delete_head" ON public.staffing_plan;
CREATE POLICY "staffing_plan_delete_head" ON public.staffing_plan
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- ── Триггеры ─────────────────────────────────────────────────────────────
-- moddatetime: автоматическое обновление updated_at при UPDATE.
DROP TRIGGER IF EXISTS staffing_plan_updated_at ON public.staffing_plan;
CREATE TRIGGER staffing_plan_updated_at
  BEFORE UPDATE ON public.staffing_plan
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- audit_trigger_fn — единая audit-функция проекта (та же, что у
-- audit_staffing_records / audit_vacancies). Срабатывает на INSERT/
-- UPDATE/DELETE и пишет в audit_logs (CLAUDE.md правило №10).
DROP TRIGGER IF EXISTS audit_staffing_plan ON public.staffing_plan;
CREATE TRIGGER audit_staffing_plan
  AFTER INSERT OR UPDATE OR DELETE ON public.staffing_plan
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
