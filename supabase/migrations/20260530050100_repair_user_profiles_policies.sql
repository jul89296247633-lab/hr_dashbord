-- 20260530050100_repair_user_profiles_policies.sql
-- Repair drift: миграционные политики user_profiles РЕКУРСИВНЫ — политика ON
-- user_profiles делает EXISTS (SELECT 1 FROM user_profiles up WHERE up.id=auth.uid()
-- AND up.role IN (...)) → "infinite recursion detected in policy for relation
-- user_profiles" на чистом локальном стенде.
--
-- Прод давно использует SECURITY DEFINER get_my_role() (читает роль в обход RLS —
-- рекурсии нет). Пересоздаём 3 политики ИДЕНТИЧНО боевым (сняты с прода через
-- pg_policies 2026-06-03). Идемпотентно; безопасно для прода (no-op при db push).
--
-- Порядок: get_my_role() создаётся репейром 20260530050000 (РАНЬШЕ этой миграции),
-- harden 20260530062400 (ПОЗЖЕ) лишь ALTER search_path — конфликта нет.
--
-- Только user_profiles была рекурсивной (политика самой таблицы читает себя же).
-- Политики ДРУГИХ таблиц используют EXISTS(SELECT FROM user_profiles ...) — это НЕ
-- рекурсия (другая таблица) и совпадает с продом (get_my_role на проде используют
-- ТОЛЬКО политики user_profiles). Их не трогаем.

DROP POLICY IF EXISTS "profiles_select"     ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_admin_all"  ON public.user_profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.user_profiles;

CREATE POLICY "profiles_select" ON public.user_profiles
  FOR SELECT
  USING (auth.uid() = id OR get_my_role() = ANY (ARRAY['head', 'admin', 'executive']));

CREATE POLICY "profiles_admin_all" ON public.user_profiles
  FOR ALL
  USING (get_my_role() = 'admin');

CREATE POLICY "profiles_update_own" ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
