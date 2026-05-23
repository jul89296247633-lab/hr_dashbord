-- ════════════════════════════════════════════════════════════════════════
-- 20260523180000_bonus_rates.sql
--
-- Новая модель бонусов HR (SPEC §5.3 / §5.6):
-- лист «Бонусы_HR» в Google Sheets — это СПРАВОЧНИК ТАРИФОВ
-- «Должность → Стоимость закрытия», а не журнал начислений.
--
-- Бонус менеджера на лету считается как сумма по его закрытым вакансиям
-- (hired_employees.status='hired') за период, где сумма каждой строки —
-- тариф из bonus_rates, fuzzy-совпавший с position_name по pg_trgm.
--
-- Старая таблица hr_bonuses пока остаётся (исторические данные +
-- audit_logs); код её больше не читает/пишет. Дроп — отдельной миграцией
-- после миграции на новую модель в проде.
-- ════════════════════════════════════════════════════════════════════════

-- ── bonus_rates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bonus_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Должность как написана в листе «Бонусы_HR»; UNIQUE для idempotent upsert.
  position_name   TEXT NOT NULL UNIQUE
                    CHECK (char_length(position_name) BETWEEN 2 AND 200),
  -- Сумма в копейках (CLAUDE.md: деньги — только INTEGER коп.).
  amount_kopecks  INTEGER NOT NULL CHECK (amount_kopecks >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GIN-индекс по trigram'ам для fuzzy-match в compute_manager_bonuses.
CREATE INDEX IF NOT EXISTS idx_bonus_rates_position_trgm
  ON public.bonus_rates USING gin (position_name gin_trgm_ops);

DROP TRIGGER IF EXISTS bonus_rates_updated_at ON public.bonus_rates;
CREATE TRIGGER bonus_rates_updated_at
  BEFORE UPDATE ON public.bonus_rates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.bonus_rates ENABLE ROW LEVEL SECURITY;

-- Справочник тарифов доступен на чтение всем аутентифицированным
-- (UI бонусов показывает «Должность + Сумма» каждому менеджеру).
DROP POLICY IF EXISTS "bonus_rates_select_authenticated" ON public.bonus_rates;
CREATE POLICY "bonus_rates_select_authenticated"
  ON public.bonus_rates FOR SELECT TO authenticated USING (TRUE);

-- service_role (sync sheets) — полный доступ.
DROP POLICY IF EXISTS "bonus_rates_service_write" ON public.bonus_rates;
CREATE POLICY "bonus_rates_service_write"
  ON public.bonus_rates FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);


-- ── RPC: compute_manager_bonuses ───────────────────────────────────────
-- Считает бонусы за период:
--   - берёт hired_employees (status='hired') в диапазоне [p_from, p_to];
--   - для каждой строки fuzzy-матчит position_name с bonus_rates по pg_trgm
--     (порог по умолчанию 0.6 — компромисс между точностью и охватом);
--   - джойнит вакансию и менеджера;
--   - если тариф не найден — rate_* и amount_kopecks возвращаются NULL
--     (UI покажет «—» вместо суммы).
--
-- SECURITY DEFINER, чтобы один запрос видел все hired_employees + vacancies
-- + user_profiles (RLS для head/admin ослабляет, но manager-роль через RLS
-- получила бы только свои). API форсит p_manager_id=auth.uid() для роли
-- manager — это инвариант, который держится в коде, не в БД.
CREATE OR REPLACE FUNCTION public.compute_manager_bonuses(
  p_from       DATE,
  p_to         DATE,
  p_manager_id UUID    DEFAULT NULL,
  p_threshold  FLOAT   DEFAULT 0.6
)
RETURNS TABLE (
  hired_id           UUID,
  manager_id         UUID,
  manager_name       TEXT,
  manager_is_active  BOOLEAN,
  vacancy_id         UUID,
  vacancy_title      TEXT,
  position_name      TEXT,
  hired_date         DATE,
  rate_id            UUID,
  rate_position_name TEXT,
  amount_kopecks     INTEGER,
  similarity_score   FLOAT
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    he.id                       AS hired_id,
    v.manager_id                AS manager_id,
    up.full_name                AS manager_name,
    up.is_active                AS manager_is_active,
    he.vacancy_id               AS vacancy_id,
    v.title                     AS vacancy_title,
    he.position_name            AS position_name,
    he.hired_date               AS hired_date,
    br.id                       AS rate_id,
    br.position_name            AS rate_position_name,
    br.amount_kopecks           AS amount_kopecks,
    br.score                    AS similarity_score
  FROM public.hired_employees he
  LEFT JOIN public.vacancies      v  ON v.id = he.vacancy_id
  LEFT JOIN public.user_profiles  up ON up.id = v.manager_id
  LEFT JOIN LATERAL (
    SELECT id, position_name, amount_kopecks,
           similarity(position_name, he.position_name) AS score
    FROM public.bonus_rates
    WHERE similarity(position_name, he.position_name) >= p_threshold
    ORDER BY score DESC
    LIMIT 1
  ) br ON TRUE
  WHERE he.status = 'hired'
    AND he.hired_date >= p_from
    AND he.hired_date <= p_to
    AND (p_manager_id IS NULL OR v.manager_id = p_manager_id);
$$;

GRANT EXECUTE ON FUNCTION
  public.compute_manager_bonuses(DATE, DATE, UUID, FLOAT)
  TO authenticated;
