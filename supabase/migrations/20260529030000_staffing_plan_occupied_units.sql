-- ════════════════════════════════════════════════════════════════════════
-- 20260529030000_staffing_plan_occupied_units.sql
--
-- Добавляет staffing_plan.occupied_units — факт занятых единиц.
-- Значение вводится вручную (через UI или XLSX), не считается из
-- hired_employees. RPC compute_staffing_plan обновлён соответственно.
--
-- Формула заполненности:
--   occupied    = staffing_plan.occupied_units
--   in_progress = COUNT(active vacancies with matching location + title)
--   vacant      = planned_units - occupied_units - in_progress
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.staffing_plan
  ADD COLUMN IF NOT EXISTS occupied_units INTEGER NOT NULL DEFAULT 0
    CHECK (occupied_units >= 0 AND occupied_units <= 999);

-- ── Обновлённый RPC ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_staffing_plan(
  p_city      TEXT  DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.4
)
RETURNS TABLE (
  id            UUID,
  city          TEXT,
  position_name TEXT,
  planned_units INTEGER,
  comment       TEXT,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  occupied      INTEGER,
  in_progress   INTEGER,
  vacant        INTEGER
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id,
    sp.city,
    sp.position_name,
    sp.planned_units,
    sp.comment,
    sp.created_at,
    sp.updated_at,
    sp.occupied_units::INTEGER                                          AS occupied,
    COALESCE(prog.cnt, 0)::INTEGER                                      AS in_progress,
    (sp.planned_units - sp.occupied_units - COALESCE(prog.cnt, 0))::INTEGER AS vacant
  FROM public.staffing_plan sp
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.vacancies v
    WHERE v.location = sp.city
      AND v.status = 'active'
      AND similarity(v.title, sp.position_name) >= p_threshold
  ) prog ON TRUE
  WHERE p_city IS NULL OR sp.city = p_city
  ORDER BY sp.city, sp.position_name;
$$;

GRANT EXECUTE ON FUNCTION
  public.compute_staffing_plan(TEXT, FLOAT)
  TO authenticated;
