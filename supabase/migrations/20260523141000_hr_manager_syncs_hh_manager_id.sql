-- ── 20260523141000_hr_manager_syncs_hh_manager_id.sql ────────────────────
-- Стабильный матч менеджеров между HH и нашей БД.
--
-- Раньше менеджеры сопоставлялись только по нормализованному ФИО
-- (fuzzy по фамилии для редких случаев двойных имён) — это хрупко
-- (опечатки, смена фамилии, латиница vs кириллица в HH).
--
-- В новом отчёте `recruitment_analytics_managers_statistics` HH отдаёт
-- колонку `id менеджера` — стабильный числовой идентификатор. Сохраняем
-- его в `hr_manager_syncs.hh_manager_id` (обогащается при первой
-- успешной загрузке CSV) и используем как приоритетный ключ матча.
--
-- Поле nullable: исторические записи без id остаются валидными, фолбэк
-- по ФИО продолжает работать пока HH-id не подтянется.

ALTER TABLE public.hr_manager_syncs
  ADD COLUMN IF NOT EXISTS hh_manager_id TEXT;

-- Уникальность среди заполненных значений: двое наших не могут
-- ссылаться на одного HH-менеджера (Postgres UNIQUE допускает много NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_manager_syncs_hh_manager_id
  ON public.hr_manager_syncs (hh_manager_id)
  WHERE hh_manager_id IS NOT NULL;
