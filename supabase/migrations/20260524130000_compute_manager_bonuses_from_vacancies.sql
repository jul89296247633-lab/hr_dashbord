-- ════════════════════════════════════════════════════════════════════════
-- 20260524130000_compute_manager_bonuses_from_vacancies.sql
--
-- Переключаем источник бонусов с hired_employees на vacancies.
-- hired_employees заполняется только sheets-sync'ом, EC-03 авто-закрытия из
-- hh-csv туда не попадают (см. диагностику 56 vs 22). vacancies — единый
-- источник истины для закрытий: status='closed' AND closed_at IN month.
--
-- Изменения сигнатуры RETURNS TABLE:
--   - убираем hired_id, position_name;
--   - hired_date → closed_at;
--   - vacancy_id теперь первичный ключ строки (вакансия может быть закрыта
--     один раз, поэтому уникален).
--
-- Threshold по умолчанию снижен 0.6 → 0.4 — оригинальный был слишком строгий
-- для русских названий с особенностями («ст. ‑менеджер» / «старший менеджер»).
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.compute_manager_bonuses(DATE, DATE, UUID, FLOAT);

CREATE OR REPLACE FUNCTION public.compute_manager_bonuses(
  p_from       DATE,
  p_to         DATE,
  p_manager_id UUID    DEFAULT NULL,
  p_threshold  FLOAT   DEFAULT 0.4
)
RETURNS TABLE (
  vacancy_id          UUID,
  manager_id          UUID,
  manager_name        TEXT,
  manager_is_active   BOOLEAN,
  vacancy_title       TEXT,
  closed_at           DATE,
  rate_id             UUID,
  rate_position_name  TEXT,
  amount_kopecks      INTEGER,
  similarity_score    FLOAT
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id                AS vacancy_id,
    v.manager_id        AS manager_id,
    up.full_name        AS manager_name,
    up.is_active        AS manager_is_active,
    v.title             AS vacancy_title,
    v.closed_at         AS closed_at,
    br.id               AS rate_id,
    br.position_name    AS rate_position_name,
    br.amount_kopecks   AS amount_kopecks,
    br.score            AS similarity_score
  FROM public.vacancies v
  LEFT JOIN public.user_profiles up ON up.id = v.manager_id
  LEFT JOIN LATERAL (
    SELECT id, position_name, amount_kopecks,
           similarity(position_name, v.title) AS score
    FROM public.bonus_rates
    WHERE similarity(position_name, v.title) >= p_threshold
    ORDER BY score DESC
    LIMIT 1
  ) br ON TRUE
  WHERE v.status = 'closed'
    AND v.closed_at IS NOT NULL
    AND v.closed_at >= p_from
    AND v.closed_at <= p_to
    AND (p_manager_id IS NULL OR v.manager_id = p_manager_id);
$$;

GRANT EXECUTE ON FUNCTION
  public.compute_manager_bonuses(DATE, DATE, UUID, FLOAT)
  TO authenticated;
