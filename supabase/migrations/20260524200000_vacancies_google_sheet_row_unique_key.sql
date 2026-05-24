-- ════════════════════════════════════════════════════════════════════════
-- 20260524200000_vacancies_google_sheet_row_unique_key.sql
--
-- Переход на google_sheet_row как ЕДИНСТВЕННЫЙ ключ дедупа sheets-sync.
-- Каждая строка листа Data ↔ ровно одна запись в БД.
--
-- 1) Снимаем UNIQUE с hh_vacancy_id (колонко-уровневая UNIQUE из
--    initial_schema создавала constraint `vacancies_hh_vacancy_id_key`).
--    Причина: фантомы CSV-импорта (откатанный hh-csv auto-create) имеют
--    hh_vacancy_id, и должны оставаться нетронутыми — а sheets-sync теперь
--    INSERT'ит/UPDATE'ит независимые Sheet-записи. Один и тот же hh_id
--    может встретиться у фантома (google_sheet_row IS NULL) и у Sheet-row
--    (google_sheet_row IS NOT NULL).
--
-- 2) Добавляем partial UNIQUE на google_sheet_row IS NOT NULL — гарантия
--    «одна Sheet-строка = одна запись». Phantoms с NULL google_sheet_row
--    под условие partial не попадают.
--
-- 3) Не-уникальный partial index idx_vacancies_hh_id остаётся как есть
--    (для lookup'ов; не накладывает уникальности).
--
-- 4) Партиальный UNIQUE (title, manager_id, opened_at) WHERE hh_vacancy_id
--    IS NULL — оставляем (защита от дублирующих Sheet-строк без hh_id).
--    Фантомы под него не попадают (у них hh_id != NULL).
--
-- NB: после миграции /api/vacancies POST перестанет 23505'ить на дубликат
-- hh_vacancy_id (handler в route.ts остаётся, но просто не сработает).
-- ════════════════════════════════════════════════════════════════════════

-- Cleanup before adding UNIQUE: в prod скопилось 15 групп дублей
-- google_sheet_row из-за сдвигов строк листа Data между sync'ами разных
-- эпох. Оставляем самую свежую по updated_at; остальным — NULL (становятся
-- фантомами, в KPI не участвуют). На чистой БД WITH/UPDATE ничего не сделает.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY google_sheet_row
           ORDER BY updated_at DESC, id
         ) AS rn
  FROM public.vacancies
  WHERE google_sheet_row IS NOT NULL
)
UPDATE public.vacancies v
SET google_sheet_row = NULL,
    updated_at = NOW()
FROM ranked r
WHERE v.id = r.id AND r.rn > 1;

ALTER TABLE public.vacancies
  DROP CONSTRAINT IF EXISTS vacancies_hh_vacancy_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS vacancies_google_sheet_row_idx
  ON public.vacancies(google_sheet_row)
  WHERE google_sheet_row IS NOT NULL;
