-- ════════════════════════════════════════════════════════════════════════
-- 20260523200000_bonus_rates_group_name.sql
--
-- Группировка тарифов по бизнес-направлению (Розница / Офис / ...).
-- nullable — старые записи остаются без группы, UI использует поле
-- только если оно заполнено.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bonus_rates
  ADD COLUMN IF NOT EXISTS group_name TEXT
    CHECK (group_name IS NULL OR char_length(group_name) BETWEEN 2 AND 100);
