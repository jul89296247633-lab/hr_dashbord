-- Таблица hr_bonuses пустая с момента создания и нигде не используется.
-- Бонусный журнал не реализован: расчёт идёт через RPC compute_manager_bonuses
-- на лету из vacancies + bonus_rates (справочник тарифов).
DROP TABLE IF EXISTS public.hr_bonuses CASCADE;
