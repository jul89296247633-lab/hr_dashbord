-- ════════════════════════════════════════════════════════════════════════
-- 20260530020000_bonus_rates_admin_only.sql
--
-- Ужесточить RLS на bonus_rates: запись только admin.
--
-- Проблема: 'bonus_rates_service_write' имела FOR ALL WITH CHECK (TRUE)
-- что позволяло ЛЮБОМУ авторизованному пользователю писать в таблицу.
-- Исправляем: явная политика для admin + service_role обходит RLS сам.
-- ════════════════════════════════════════════════════════════════════════

-- Удаляем слишком широкую политику
DROP POLICY IF EXISTS "bonus_rates_service_write" ON public.bonus_rates;

-- Только admin может создавать/изменять/удалять тарифы через user-сессию
-- (service_role для sheets-sync и XLSX-онбординга обходит RLS автоматически)
CREATE POLICY "bonus_rates_admin_write" ON public.bonus_rates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
