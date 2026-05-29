-- ════════════════════════════════════════════════════════════════════════
-- 20260529010000_vacancy_request_fixes.sql
--
-- Исправления по code review feature/vacancy-request:
--
-- 1. vacancies_request_approve: добавляем DB-проверку what auth.uid() ≠
--    requested_by — двойная защита self-approve (API + DB).
--
-- 2. enforce_request_approval: ограничиваем блокировку draft→active только
--    заявками (OLD.requested_by IS NOT NULL). Обычные вакансии из Sheets-sync
--    или будущего PATCH /api/vacancies не затрагиваются триггером.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. RLS: vacancies_request_approve + self-approve guard ───────────────
-- Было: executive может UPDATE любой вакансии.
-- Стало: executive может UPDATE только если сам НЕ является автором заявки
--        (auth.uid() IS DISTINCT FROM requested_by).
-- head/admin по-прежнему покрыты vacancies_write FOR ALL (без этого ограничения).
DROP POLICY IF EXISTS "vacancies_request_approve" ON public.vacancies;
CREATE POLICY "vacancies_request_approve" ON public.vacancies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'executive'
    )
    AND auth.uid() IS DISTINCT FROM requested_by
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'executive'
    )
  );

-- ── 2. Trigger: enforce только для заявок (requested_by IS NOT NULL) ─────
-- OLD.requested_by IS NOT NULL — признак заявки из request-flow.
-- Обычные вакансии (sheets-sync, HEAD-created) имеют requested_by = NULL
-- и могут свободно переходить draft→active без request_status='approved'.
CREATE OR REPLACE FUNCTION public.enforce_request_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'draft'
     AND OLD.requested_by IS NOT NULL   -- только заявки, не обычные вакансии
  THEN
    IF NEW.request_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION
        'Нельзя активировать вакансию без согласования заявки '
        '(request_status = ''approved'' обязателен)';
    END IF;
    IF NEW.confidentiality = 'open' AND NEW.hh_vacancy_id IS NULL THEN
      RAISE EXCEPTION
        'Открытая вакансия требует hh_vacancy_id для активации';
    END IF;
    IF NEW.confidentiality = 'confidential' AND NEW.internal_ref IS NULL THEN
      NEW.internal_ref := public.gen_internal_ref();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Триггер уже существует — DROP + CREATE обновит функцию без изменения trigger-а,
-- но явно пересоздаём для идемпотентности.
DROP TRIGGER IF EXISTS trg_enforce_request_approval ON public.vacancies;
CREATE TRIGGER trg_enforce_request_approval
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_request_approval();
