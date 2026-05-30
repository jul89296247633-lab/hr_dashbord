-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening: SEC-001 / SEC-002 / SEC-003 / SEC-004 / SEC-005
--
-- Аудит 2026-05-30 (security audit, проект hr_dashbord). Закрывает:
--   SEC-001  compute_manager_bonuses (SECURITY DEFINER) исполнялась anon через
--            REST RPC → анонимная утечка зарплатных данных (доказано: anon POST
--            вернул 200 + 28 строк + ФИО/суммы). Двойная защита: REVOKE EXECUTE
--            у anon + внутренняя авторизация по auth.role()/auth.uid().
--   SEC-002  прочие data-RPC исполнимы anon (compute_staffing_plan,
--            find_vacancy_by_title, gen_internal_ref) → REVOKE у anon.
--   SEC-003  триггер-функции выставлены в REST для anon/authenticated → REVOKE.
--   SEC-004  три INSERT-политики TO public WITH CHECK(true) → DROP.
--   SEC-005  mutable search_path у 6 функций → pin = public.
--
-- ИНВАРИАНТЫ (проверено перед миграцией):
--   • service_role сохраняет EXECUTE (явный грант) — server-side вызовы целы.
--   • Триггеры срабатывают независимо от EXECUTE-привилегии функции.
--   • get_my_role() НЕ трогаем по EXECUTE — используется в RLS-политиках
--     user_profiles (profiles_select / profiles_admin_all); отзыв сломал бы
--     getAuthUser. Только пиним ей search_path.
--   • Запись в audit_logs/error_logs/vacancy_snapshots идёт через service_role
--     (обход RLS) и SECURITY DEFINER триггеры → DROP политик не ломает запись.
--   • Ни одна функция/представление не вызывает compute_manager_bonuses внутри
--     → косвенного anon-пути в обход REVOKE нет.
-- ════════════════════════════════════════════════════════════════════════════

-- ── SEC-001: внутренняя авторизация в compute_manager_bonuses ────────────────
-- Доступ к строкам:
--   • service_role (auth.role()='service_role', доверенный server-side) ИЛИ
--     head/admin/executive → все строки (или фильтр по p_manager_id);
--   • обычный manager → только свои закрытия (p_manager_id игнорируется);
--   • anon (auth.role()='anon', auth.uid() IS NULL) → 0 строк
--     (defense-in-depth поверх REVOKE: даже при ошибочном GRANT anon ничего
--      не получит, т.к. auth.role() ≠ 'service_role').
CREATE OR REPLACE FUNCTION public.compute_manager_bonuses(
  p_from date,
  p_to date,
  p_manager_id uuid DEFAULT NULL::uuid,
  p_threshold double precision DEFAULT 0.4
)
RETURNS TABLE(
  vacancy_id uuid, manager_id uuid, manager_name text, manager_is_active boolean,
  vacancy_title text, closed_at date, rate_id uuid, rate_position_name text,
  amount_kopecks integer, similarity_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    AND (
      -- доверенный server-side (service_role) ИЛИ привилегированные роли
      ( ( auth.role() = 'service_role'
          OR (SELECT role FROM public.user_profiles WHERE id = auth.uid())
               IN ('head', 'admin', 'executive') )
        AND (p_manager_id IS NULL OR v.manager_id = p_manager_id) )
      OR
      -- обычный менеджер: только свои закрытия, p_manager_id игнорируется
      v.manager_id = auth.uid()
    );
$function$;

-- ── SEC-001/002/003: REVOKE EXECUTE у anon + PUBLIC ─────────────────────────
-- data-RPC: authenticated + service_role СОХРАНЯЮТСЯ (вызов из server.ts client).
REVOKE EXECUTE ON FUNCTION public.compute_manager_bonuses(date, date, uuid, double precision) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.compute_staffing_plan(text, double precision)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gen_internal_ref()                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_vacancy_by_title(text, double precision)                FROM PUBLIC, anon;

-- триггер-функции: прямой RPC не нужен; срабатывание триггера от EXECUTE не зависит.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_bonus_on_close() FROM PUBLIC, anon, authenticated;

-- ── SEC-004: убрать INSERT-политики TO public WITH CHECK(true) ──────────────
-- Запись идёт через service_role (обход RLS) и SECURITY DEFINER триггеры.
DROP POLICY IF EXISTS audit_logs_service_write ON public.audit_logs;
DROP POLICY IF EXISTS error_logs_service_write ON public.error_logs;
DROP POLICY IF EXISTS snapshots_service_insert ON public.vacancy_snapshots;

-- ── SEC-005: pin search_path у 6 функций (= public, как у уже-исправленных) ──
ALTER FUNCTION public.handle_new_user()                             SET search_path = public;
ALTER FUNCTION public.audit_trigger_fn()                            SET search_path = public;
ALTER FUNCTION public.enforce_request_approval()                    SET search_path = public;
ALTER FUNCTION public.get_my_role()                                 SET search_path = public;
ALTER FUNCTION public.find_vacancy_by_title(text, double precision) SET search_path = public;
ALTER FUNCTION public.fuzzy_match_vacancy(text, double precision)   SET search_path = public;
