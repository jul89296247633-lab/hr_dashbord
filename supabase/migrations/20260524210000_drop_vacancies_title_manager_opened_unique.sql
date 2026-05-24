-- ════════════════════════════════════════════════════════════════════════
-- 20260524210000_drop_vacancies_title_manager_opened_unique.sql
--
-- Сносим partial UNIQUE (title, manager_id, opened_at) WHERE hh_vacancy_id
-- IS NULL — добавлен миграцией 20260523220000 для дедупа Sheet-строк без
-- ID HH. С переходом на google_sheet_row как singular key (миграция
-- 20260524200000) этот constraint мешает: при INSERT новой Sheet-строки
-- без hh_id, если уже есть запись с теми же (title, manager, opened) и
-- NULL hh_id (например, фантом или старая Sheet-запись), PG бросает 23505
-- и sheets-sync падает.
--
-- google_sheet_row уже гарантирует "одна Sheet-строка ↔ одна запись".
-- Двойные занесения с тем же title/manager/opened возможны (разные строки
-- листа), но это responsibility HR при заполнении листа.
-- ════════════════════════════════════════════════════════════════════════

-- Может быть как CONSTRAINT, так и просто INDEX — drop both вариативно.
ALTER TABLE public.vacancies
  DROP CONSTRAINT IF EXISTS uq_vacancies_title_manager_opened_no_hh;

DROP INDEX IF EXISTS public.uq_vacancies_title_manager_opened_no_hh;
