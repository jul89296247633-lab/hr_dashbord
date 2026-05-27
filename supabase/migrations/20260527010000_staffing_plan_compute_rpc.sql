-- ════════════════════════════════════════════════════════════════════════
-- 20260527010000_staffing_plan_compute_rpc.sql
--
-- RPC compute_staffing_plan — расчёт заполненности штатного расписания
-- на лету. Используется в /api/staffing/plan и /api/staffing/availability.
--
-- Возвращает строки staffing_plan + три derived поля:
--   • occupied    — сколько занято (hired_employees status IN hired|probation)
--   • in_progress — сколько в работе (vacancies status='active')
--   • vacant      — planned − occupied − in_progress (может быть отрицательным)
--
-- Матчинг:
--   • Город     = exact equality (v.location = sp.city)
--   • Должность = pg_trgm similarity ≥ p_threshold (по умолчанию 0.4).
--     Тот же порог что у бонусов (compute_manager_bonuses). Меняй здесь —
--     fallback на ноль если LEFT JOIN не нашёл совпадений (COALESCE).
--
-- SECURITY DEFINER: чтобы любой авторизованный (включая manager / executive)
-- мог получить агрегаты без доступа к vacancies/hired_employees по RLS.
-- Возвращаются только COUNT'ы, не конкретные записи — раскрытия нет.
-- ════════════════════════════════════════════════════════════════════════

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
    COALESCE(occ.cnt,  0)::INTEGER AS occupied,
    COALESCE(prog.cnt, 0)::INTEGER AS in_progress,
    (sp.planned_units - COALESCE(occ.cnt, 0) - COALESCE(prog.cnt, 0))::INTEGER AS vacant
  FROM public.staffing_plan sp
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.hired_employees he
    JOIN public.vacancies v ON v.id = he.vacancy_id
    WHERE v.location = sp.city
      AND he.status IN ('hired', 'probation')
      AND similarity(he.position_name, sp.position_name) >= p_threshold
  ) occ ON TRUE
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
