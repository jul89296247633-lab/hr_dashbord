-- ════════════════════════════════════════════════════════════════════════
-- 20260524180000_compute_manager_bonuses_drop_sheet_row_filter.sql
--
-- Откат фильтра v.google_sheet_row IS NOT NULL из RPC compute_manager_bonuses
-- (введён в 20260524170000). Теперь источник бонусов = все vacancies со
-- status='closed' AND closed_at ∈ [p_from, p_to] — независимо от того,
-- проставлен ли google_sheet_row при последней синхронизации.
--
-- Причина отката: HR ведёт лист Data так, что «закрытые» строки могут не
-- иметь точной даты в колонке «Дата закрытия» (только «Месяц закрытия»),
-- и не все строки получают google_sheet_row на каждой sync-итерации
-- (сдвиги rowIndex при правках листа). Фильтр давал стабильный 0 закрытых
-- за май. Согласовано с дашбордными запросами в team/me/manager/divisions
-- (коммит 87b8c77 — там фильтр уже снят).
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
