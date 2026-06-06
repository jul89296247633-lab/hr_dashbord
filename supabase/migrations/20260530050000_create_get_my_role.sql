-- 20260530050000_create_get_my_role.sql
-- Repair drift: public.get_my_role() существует на проде (создана вне цепочки
-- миграций), но НИ ОДНА миграция её не создаёт. На чистой локальной БД
-- (`supabase start`) следующая миграция 20260530062400_harden_rpc_grants_and_rls
-- падает на `ALTER FUNCTION public.get_my_role() SET search_path = public`.
--
-- Timestamp 20260530050000 — ДО harden (…062400). Определение взято с прода через
-- pg_get_functiondef, идентично боевому → CREATE OR REPLACE безопасен и для прода
-- при следующем db push (ничего не меняет на проде, лишь фиксирует функцию в цепочке).
--
-- Используется в RLS-политиках (роль текущего пользователя из user_profiles).
-- SECURITY DEFINER + фикс search_path — функция читает user_profiles в обход RLS.

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid()
$$;
