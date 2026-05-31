-- ════════════════════════════════════════════════════════════════════════════
-- FEATURE_SPEC #2: Авто-укомплектованность на точной привязке вакансия↔штатка.
--  • vacancies.staffing_plan_id (FK → staffing_plan, ON DELETE SET NULL) + индекс;
--  • backfill точных совпадений (city + position);
--  • новый compute_staffing_plan: занято = ТОЛЬКО closed; дыра = NOT IN ('closed','draft');
--    occupied = GREATEST(planned − holes, 0), vacant = holes; БЕЗ in_progress; матчинг
--    по staffing_plan_id (не fuzzy);
--  • восстановление грантов SEC-001 после DROP (REVOKE anon/public + GRANT authenticated).
-- occupied_units НЕ дропаем (legacy) — RPC её больше не читает.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. vacancies.staffing_plan_id ────────────────────────────────────────────
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS staffing_plan_id UUID REFERENCES public.staffing_plan(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_staffing_plan
  ON public.vacancies (staffing_plan_id) WHERE staffing_plan_id IS NOT NULL;

-- ── 2. Backfill: точные совпадения (город + должность), только непривязанные ──
UPDATE public.vacancies v
SET staffing_plan_id = sp.id
FROM public.staffing_plan sp
WHERE v.staffing_plan_id IS NULL
  AND v.location = sp.city
  AND v.title = sp.position_name;

-- ── 3. Новый compute_staffing_plan ───────────────────────────────────────────
-- DROP+CREATE: меняется RETURNS TABLE (убираем in_progress). Сигнатуру
-- (text, double precision) сохраняем — call-sites не меняются; p_threshold не используется.
DROP FUNCTION IF EXISTS public.compute_staffing_plan(text, double precision);

CREATE FUNCTION public.compute_staffing_plan(
  p_city text DEFAULT NULL,
  p_threshold double precision DEFAULT 0.4
)
RETURNS TABLE (
  id uuid,
  city text,
  position_name text,
  planned_units integer,
  comment text,
  created_at timestamptz,
  updated_at timestamptz,
  occupied integer,
  vacant integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id, sp.city, sp.position_name, sp.planned_units, sp.comment, sp.created_at, sp.updated_at,
    GREATEST(sp.planned_units - COALESCE(h.holes, 0), 0)::INTEGER AS occupied,
    COALESCE(h.holes, 0)::INTEGER                                 AS vacant
  FROM public.staffing_plan sp
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS holes
    FROM public.vacancies v
    WHERE v.staffing_plan_id = sp.id
      -- ДЫРА (место пустое) = любой активированный статус, КРОМЕ closed:
      -- active/probation/paused/cancelled. Занято ТОЛЬКО closed (реальный найм).
      -- draft (заявка до активации, в т.ч. отклонённая) НЕ считается дырой.
      AND v.status NOT IN ('closed', 'draft')
  ) h ON TRUE
  WHERE p_city IS NULL OR sp.city = p_city
  ORDER BY sp.city, sp.position_name;
$$;

-- ── 4. Восстановить гранты SEC-001 (DROP сбросил ACL) ────────────────────────
-- Без этого функция вернёт дефолтный PUBLIC EXECUTE → регресс безопасности (anon-RPC).
REVOKE EXECUTE ON FUNCTION public.compute_staffing_plan(text, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_staffing_plan(text, double precision) TO authenticated;
