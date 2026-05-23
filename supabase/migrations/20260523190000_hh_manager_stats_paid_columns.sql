-- ════════════════════════════════════════════════════════════════════════
-- 20260523190000_hh_manager_stats_paid_columns.sql
--
-- Разделение «просмотров резюме» на бесплатные (из входящих откликов)
-- и платные (когда менеджер сам нашёл кандидата в базе HH).
-- Плюс отдельный счётчик платных контактов из базы резюме.
--
--   responses_viewed              — уже было: бесплатные «Просмотры из отклика»
--                                   (UI label «Просмотры (отклики)»).
--   resume_views_from_search NEW  — платные: просмотры резюме, найденных
--                                   менеджером через поиск/базу HH.
--   invitations_from_db      NEW  — платные: приглашения из базы резюме.
--
-- Все три поля nullable INTEGER: HH-отчёт может не отдать колонку
-- (старые CSV / частичные выгрузки) — тогда оставляем NULL.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.hh_manager_stats
  ADD COLUMN IF NOT EXISTS resume_views_from_search INTEGER
    CHECK (resume_views_from_search IS NULL OR resume_views_from_search >= 0),
  ADD COLUMN IF NOT EXISTS invitations_from_db INTEGER
    CHECK (invitations_from_db IS NULL OR invitations_from_db >= 0);
