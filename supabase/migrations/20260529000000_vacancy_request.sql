-- ════════════════════════════════════════════════════════════════════════
-- 20260529000000_vacancy_request.sql
--
-- Фича «Заявка на вакансию» (FEATURE_SPEC_vacancy_request.md).
-- Заявка = vacancies со status='draft'. Новой таблицы НЕТ.
--
-- ВНИМАНИЕ: confidentiality и internal_ref уже добавлены миграцией
--   20260528000000_template_onboarding.sql — здесь НЕ добавляем повторно.
--
-- Блок 1 — Data Model:
--   1. Новые поля vacancies: request_reason, request_status, requested_by,
--      approved_by, approved_at, rejection_reason.
--   2. Индексы по request_status, requested_by.
--   3. Sequence conf_vacancy_seq + setval по MAX существующих internal_ref.
--   4. gen_internal_ref() — ЕДИНСТВЕННЫЙ источник CONF-ГГГГ-NNNN.
--      lib/templates/internal-ref.ts тоже переключается на этот RPC
--      (был COUNT-based → теперь nextval). Никаких коллизий.
--   5. Триггер enforce_request_approval: draft→active только с approved.
--   6. RLS: обновлённый vacancies_select + три новые политики.
--
-- НЕ трогаем: audit_vacancies (CLAUDE.md №10), /staffing, sheets-sync.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Новые поля ─────────────────────────────────────────────────────────

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS request_reason TEXT
    CHECK (request_reason IS NULL OR char_length(request_reason) <= 1000);

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS request_status TEXT
    CHECK (request_status IS NULL OR
           request_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS requested_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS approved_by UUID
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT
    CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500);

-- ── 2. Индексы ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_vacancies_request_status
  ON public.vacancies(request_status)
  WHERE request_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_requested_by
  ON public.vacancies(requested_by)
  WHERE requested_by IS NOT NULL;

-- ── 3. Sequence + инициализация ───────────────────────────────────────────
-- Sequence глобальный (не по году). Формат: CONF-{YYYY}-{NNNN}.
-- Инициализируем по MAX существующих internal_ref, чтобы фича 2
-- (template_upload, COUNT-based) не пересеклась с новыми номерами.
CREATE SEQUENCE IF NOT EXISTS public.conf_vacancy_seq START 1;

DO $$
DECLARE
  max_n INTEGER;
BEGIN
  -- Извлекаем числовой суффикс из существующих CONF-ГГГГ-NNNN
  SELECT MAX(
    CAST(substring(internal_ref, '\d{1,6}$') AS INTEGER)
  )
  INTO max_n
  FROM public.vacancies
  WHERE internal_ref ~ '^CONF-\d{4}-\d+$';

  IF max_n IS NOT NULL AND max_n > 0 THEN
    PERFORM setval('public.conf_vacancy_seq', max_n);
    -- следующий nextval() = max_n + 1
  END IF;
  -- Если нет существующих рефов — sequence остаётся на START 1
END;
$$;

-- ── 4. gen_internal_ref() ─────────────────────────────────────────────────
-- ЕДИНСТВЕННЫЙ источник номеров. Вызывается:
--   a) Триггером enforce_request_approval (авто-генерация при активации).
--   b) API /activate и lib/templates/internal-ref.ts через RPC.
-- SECURITY DEFINER чтобы nextval() был доступен authenticated-роли.
CREATE OR REPLACE FUNCTION public.gen_internal_ref()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'CONF-' || to_char(NOW(), 'YYYY') || '-'
         || lpad(nextval('public.conf_vacancy_seq')::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.gen_internal_ref() TO authenticated;

-- ── 5. Триггер enforce_request_approval ────────────────────────────────────
-- BEFORE UPDATE: защищает переход draft→active от обхода через прямой SQL.
-- Аудит пишется существующим триггером audit_vacancies автоматически
-- (CLAUDE.md правило №10) — ручной INSERT в audit_logs НЕ нужен.

CREATE OR REPLACE FUNCTION public.enforce_request_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN
    IF NEW.request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION
        'Нельзя активировать вакансию без согласования заявки '
        '(request_status = ''approved'' обязателен)';
    END IF;
    IF NEW.confidentiality = 'open' AND NEW.hh_vacancy_id IS NULL THEN
      RAISE EXCEPTION
        'Открытая вакансия требует hh_vacancy_id для активации';
    END IF;
    -- Конфиденциальная: генерим internal_ref если API не задал его заранее
    IF NEW.confidentiality = 'confidential' AND NEW.internal_ref IS NULL THEN
      NEW.internal_ref := public.gen_internal_ref();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_request_approval ON public.vacancies;
CREATE TRIGGER trg_enforce_request_approval
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_request_approval();

-- ── 6. RLS ────────────────────────────────────────────────────────────────

-- 6a. vacancies_select: добавляем OR requested_by = auth.uid().
--     Менеджер видит свои вакансии (manager_id) + свои заявки (requested_by).
DROP POLICY IF EXISTS "vacancies_select" ON public.vacancies;
CREATE POLICY "vacancies_select" ON public.vacancies
  FOR SELECT USING (
    manager_id   = auth.uid()
    OR requested_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role IN ('head', 'admin', 'executive')
    )
  );

-- 6b. vacancies_request_insert: любой аутентифицированный создаёт черновик.
--     CHECK гарантирует: только draft + pending + автор = себя.
DROP POLICY IF EXISTS "vacancies_request_insert" ON public.vacancies;
CREATE POLICY "vacancies_request_insert" ON public.vacancies
  FOR INSERT WITH CHECK (
    requested_by  = auth.uid()
    AND status        = 'draft'
    AND request_status = 'pending'
  );

-- 6c. vacancies_draft_author_update: автор черновика правит его и активирует.
--     head/admin уже имеют доступ через существующую vacancies_write FOR ALL.
DROP POLICY IF EXISTS "vacancies_draft_author_update" ON public.vacancies;
CREATE POLICY "vacancies_draft_author_update" ON public.vacancies
  FOR UPDATE
  USING  (requested_by = auth.uid() AND status = 'draft')
  WITH CHECK (requested_by = auth.uid());

-- 6d. vacancies_request_approve: executive согласовывает/отклоняет.
--     head/admin покрыты vacancies_write. Проверку «не свою» делает API.
DROP POLICY IF EXISTS "vacancies_request_approve" ON public.vacancies;
CREATE POLICY "vacancies_request_approve" ON public.vacancies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'executive'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'executive'
    )
  );
