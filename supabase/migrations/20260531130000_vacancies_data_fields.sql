-- 20260531130000_vacancies_data_fields.sql
-- FEATURE_SPEC #3 — сводная таблица вакансий в стиле Google Sheets «Data».
--
-- Аддитивная миграция: новый enum + 4 поля + CHECK-лимиты + депрекация department.
-- НЕТ DROP функций → ACL существующих SECURITY DEFINER функций не сбрасывается,
-- регресса SEC-001 быть не может. Новых таблиц/функций нет → новых RLS-политик
-- не требуется (vacancies уже под RLS, новые колонки покрываются построчно).

-- ── 1. Enum причины появления вакансии ──────────────────────────────────────
CREATE TYPE public.appearance_reason AS ENUM
  ('dismissal', 'replacement', 'expansion', 'internal_transfer', 'other');

-- ── 2. Новые поля vacancies ─────────────────────────────────────────────────
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS appearance_reason public.appearance_reason,  -- Причина появления (структура, фильтры)
  ADD COLUMN IF NOT EXISTS explanation       text,                      -- Пояснение (свободный текст, пара к причине)
  ADD COLUMN IF NOT EXISTS candidate_name    text,                      -- ФИО нанятого кандидата (строкой)
  ADD COLUMN IF NOT EXISTS comment           text;                      -- Комментарий (≠ request_reason)

-- ── 3. Лимиты длины (зеркалят Zod, защита на уровне БД) ──────────────────────
ALTER TABLE public.vacancies
  ADD CONSTRAINT vacancies_explanation_len    CHECK (explanation    IS NULL OR char_length(explanation)    <= 2000),
  ADD CONSTRAINT vacancies_candidate_name_len CHECK (candidate_name IS NULL OR char_length(candidate_name) <= 200),
  ADD CONSTRAINT vacancies_comment_len        CHECK (comment        IS NULL OR char_length(comment)        <= 2000);

-- ── 4. Депрекация department ────────────────────────────────────────────────
-- Данные пусты на 100% (0/200), миграция данных НЕ нужна. Колонку НЕ дропаем
-- (legacy, недеструктивно). Каноническое поле подразделения — subdivision.
COMMENT ON COLUMN public.vacancies.department IS
  'DEPRECATED 2026-05-31 (FEATURE_SPEC #3): каноническое поле подразделения — subdivision. Не писать. Дроп — отдельной поздней миграцией после удаления всех ссылок.';
