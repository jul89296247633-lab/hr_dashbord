-- ════════════════════════════════════════════════════════════════════════
-- 20260523170000_cleanup_header_rows_in_managers.sql
--
-- Удаление «фантомных» менеджеров, появившихся из строк-заголовков листа
-- «HR_менеджеры» Google Sheets. Значения 'HR менеджеры' и 'Нг менеджеры'
-- (последнее — кириллический омоглиф: Н=H, г=r) попадали в hr_manager_syncs
-- как имя менеджера и затем — через автопровизионинг — создавали
-- мусорный auth.users / user_profiles.
--
-- Идемпотентно (DELETE без условий с CTE-результатом).
-- Фильтр в коде (src/app/api/sync/sheets/route.ts → isHeaderLikeManagerName)
-- не пускает такие строки повторно.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Снимаем привязку с hr_manager_syncs (или удаляем строку целиком,
--    если она сама заголовок).
DELETE FROM public.hr_manager_syncs
WHERE LOWER(TRIM(sheet_full_name)) IN ('hr менеджеры', 'нг менеджеры');

-- 2) Удаляем auth.users по id фантомного профиля.
--    ON DELETE CASCADE на user_profiles.id → auth.users.id
--    сам уберёт public.user_profiles.
DELETE FROM auth.users
WHERE id IN (
  SELECT id FROM public.user_profiles
  WHERE LOWER(TRIM(full_name)) IN ('hr менеджеры', 'нг менеджеры')
);

-- 3) Подчищаем orphan-профили (если auth.users уже не было).
DELETE FROM public.user_profiles
WHERE LOWER(TRIM(full_name)) IN ('hr менеджеры', 'нг менеджеры');
