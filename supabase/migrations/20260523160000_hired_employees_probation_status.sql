-- ── 20260523160000_hired_employees_probation_status.sql ──────────────────
-- Этап «Стажировка» в воронке найма (SPEC §5.3 / Блок 0).
--
-- Бизнес:
--   - Лист «Data» в Sheets, колонка N: значения «Открыта» / «Закрыта» / «стажировка».
--   - «стажировка» → кандидат принят на испытательный срок, но вакансия НЕ
--     закрывается (vacancies.status='active', closed_at=NULL). В hired_employees
--     создаётся запись с employment_type='intern' и status='probation'.
--   - Когда HR в Sheets меняет статус на «закрыта» — мы поднимаем
--     vacancies.status='closed' и (для записи в hired_employees) status='hired'.
--
-- Почему отдельная колонка `status`, а не использование только employment_type:
--   - `employment_type='employee'|'intern'` остаётся про **тип занятости**
--     (постоянный сотрудник vs стажёр). Эта семантика уже зашита в API
--     /api/dashboard/manager и /api/vacancies/[id]/funnel — менять её рискованно.
--   - `status='hired'|'probation'` — **фаза найма** (закрыт vs ещё на стажировке).
--     По задаче пользователя «status='probation'» — буквально.
--
-- DEFAULT 'hired' → существующие строки автоматически получают status='hired'
-- без дополнительного UPDATE. Новые INSERT без явного status — тоже 'hired'.

ALTER TABLE public.hired_employees
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'hired'
  CHECK (status IN ('hired', 'probation'));
