-- ════════════════════════════════════════════════════════════════════════
-- 20260524000000_vacancy_snapshots_funnel_fields.sql
--
-- Расширяем vacancy_snapshots новой моделью воронки отдела (см. SPEC §5.3):
--   - переименование invitations_sent → invitations_from_responses
--     (это и было «приглашения из откликов», просто колонка плохо называлась);
--   - +invitations_from_db   — платные приглашения из базы резюме HH;
--   - +calls_count           — звонки кандидатам, теперь приходят в CSV «vacancies».
--
-- Старые ссылки в коде на invitations_sent должны быть переименованы.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vacancy_snapshots
  RENAME COLUMN invitations_sent TO invitations_from_responses;

ALTER TABLE public.vacancy_snapshots
  ADD COLUMN IF NOT EXISTS invitations_from_db INTEGER
    CHECK (invitations_from_db IS NULL OR invitations_from_db >= 0);

ALTER TABLE public.vacancy_snapshots
  ADD COLUMN IF NOT EXISTS calls_count INTEGER
    CHECK (calls_count IS NULL OR calls_count >= 0);
