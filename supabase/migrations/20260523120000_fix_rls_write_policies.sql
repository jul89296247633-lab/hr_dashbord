-- ════════════════════════════════════════════════════════════════════════
-- 20260523120000_fix_rls_write_policies.sql
-- HR Control Tower — закрытие RLS-блокеров кросс-модельного ревью (шаг 4.5).
--
-- Проблема: политики FOR ALL WITH CHECK (TRUE) без USING давали залогиненному
-- пользователю UPDATE/DELETE на 7 таблиц через PostgREST. Cron-сервисам они
-- не нужны: они ходят под service_role и обходят RLS целиком.
--
-- Решение:
--  • DROP широких FOR ALL WITH CHECK(TRUE) на 7 таблицах.
--  • Для таблиц, которые API пишет ПОД RLS-клиентом (daily_activities, ai_insights),
--    добавить узкие head/admin INSERT/UPDATE-политики (manager_own остаётся).
--  • handle_new_user: whitelist роли из raw_user_meta_data (иначе 'manager').
--  • Бонусом — починить ai_insights SELECT: убрать `manager_id IS NULL` из общего
--    OR (раньше weekly_report leak'ил менеджеру при прямом доступе через PostgREST).
--
-- Идемпотентно: DROP POLICY IF EXISTS перед CREATE; CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════


-- ── daily_activities ────────────────────────────────────────────────────────
-- API пишет через RLS-клиент: manager_own (FOR ALL) — для своих, нужны
-- отдельные head/admin INSERT/UPDATE для записи активности другого менеджера.
DROP POLICY IF EXISTS "activities_service_upsert" ON public.daily_activities;

DROP POLICY IF EXISTS "activities_head_insert" ON public.daily_activities;
CREATE POLICY "activities_head_insert" ON public.daily_activities
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  );

DROP POLICY IF EXISTS "activities_head_update" ON public.daily_activities;
CREATE POLICY "activities_head_update" ON public.daily_activities
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  );

-- ── ai_insights ─────────────────────────────────────────────────────────────
-- generate POST + [id]/read PATCH идут под RLS-клиентом → нужны узкие политики.
DROP POLICY IF EXISTS "ai_insights_service_write" ON public.ai_insights;

DROP POLICY IF EXISTS "ai_insights_head_insert" ON public.ai_insights;
CREATE POLICY "ai_insights_head_insert" ON public.ai_insights
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  );

DROP POLICY IF EXISTS "ai_insights_head_update" ON public.ai_insights;
CREATE POLICY "ai_insights_head_update" ON public.ai_insights
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  );

-- 🟠 fix: убираем leak weekly_report (manager_id IS NULL) для менеджеров через
-- прямой PostgREST. Теперь видят только head/admin.
DROP POLICY IF EXISTS "ai_insights_manager_own" ON public.ai_insights;
DROP POLICY IF EXISTS "ai_insights_select" ON public.ai_insights;
CREATE POLICY "ai_insights_select" ON public.ai_insights
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role IN ('head', 'admin')
    )
  );

-- ── Таблицы, которые пишутся ТОЛЬКО под service_role (cron/sync) ─────────────
-- service_role обходит RLS, поэтому никаких write-политик для них не нужно.
DROP POLICY IF EXISTS "hired_service_write" ON public.hired_employees;
DROP POLICY IF EXISTS "hr_syncs_service_write" ON public.hr_manager_syncs;
DROP POLICY IF EXISTS "bonuses_service_write" ON public.hr_bonuses;
DROP POLICY IF EXISTS "hh_stats_service_write" ON public.hh_manager_stats;
DROP POLICY IF EXISTS "sync_logs_service_all" ON public.sync_logs;


-- ════════════════════════════════════════════════════════════════════════
-- handle_new_user: whitelist роли (🔴 #2)
-- При публичной регистрации (если случайно включена) злоумышленник не сможет
-- передать role='admin' в raw_user_meta_data — fallback всегда 'manager'.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_requested TEXT := NEW.raw_user_meta_data ->> 'role';
  v_role      TEXT;
BEGIN
  IF v_requested IN ('manager', 'head', 'executive', 'admin') THEN
    v_role := v_requested;
  ELSE
    v_role := 'manager';
  END IF;

  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'Новый пользователь'),
    v_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
