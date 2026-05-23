-- ════════════════════════════════════════════════════════════════════════
-- 20260523220000_vacancies_unique_title_manager_opened.sql
--
-- Различаем вакансии с одинаковым названием у одного менеджера, открытые в
-- разные даты. До этого sheets-sync дедуплицировал по (title, manager_id) —
-- две вакансии «Менеджер по продажам / Анисимова Диана» открытые в январе и
-- апреле схлопывались в одну, и при закрытии второй перетиралась дата
-- закрытия первой.
--
-- Только для строк без hh_vacancy_id (для тех уже есть UNIQUE на hh_vacancy_id).
-- ════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_vacancies_title_manager_opened_no_hh
  ON public.vacancies (manager_id, title, opened_at)
  WHERE hh_vacancy_id IS NULL;
