-- ════════════════════════════════════════════════════════════════════════════
-- FEATURE_SPEC #1: Ввод вакансий (закрытие Google Sheets «Data»). См. spec.
--  • статусы 'probation' (Стажировка) и 'cancelled' (Отмена ≠ paused);
--  • группа позиций (position_group_id/queue_index) + эстафета дат;
--  • hired_employees: source ('sheets'/'app') + nullable sheet_row_id;
--  • триггеры авто-hired_employees при закрытии/стажировке и эстафеты дат.
-- cancelled НЕ порождает hired_employees и НЕ двигает эстафету (исключён из WHEN).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. vacancies: статусы probation/cancelled + группа позиций ───────────────
ALTER TABLE public.vacancies DROP CONSTRAINT IF EXISTS vacancies_status_check;
ALTER TABLE public.vacancies ADD CONSTRAINT vacancies_status_check
  CHECK (status IN ('draft', 'active', 'probation', 'paused', 'closed', 'cancelled'));

ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS position_group_id UUID,
  ADD COLUMN IF NOT EXISTS queue_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_vacancies_position_group
  ON public.vacancies (position_group_id, queue_index)
  WHERE position_group_id IS NOT NULL;

-- ── 2. hired_employees: источник + nullable sheet_row_id ─────────────────────
ALTER TABLE public.hired_employees
  ALTER COLUMN sheet_row_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'sheets'
    CHECK (source IN ('sheets', 'app'));

-- Дедуп app-записей: одна строка на (vacancy_id, status) среди source='app'.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hired_employees_app_vacancy_status
  ON public.hired_employees (vacancy_id, status)
  WHERE source = 'app';

-- ── 3. Триггер: авто-создание hired_employees при закрытии/стажировке ────────
CREATE OR REPLACE FUNCTION public.auto_hired_employee_on_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_name TEXT;
BEGIN
  -- Только closed (employee/hired) или probation (intern/probation).
  -- 'cancelled' сюда не попадает → фантомных нанятых нет.
  IF NEW.status NOT IN ('closed', 'probation') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_manager_name
  FROM public.user_profiles WHERE id = NEW.manager_id;

  INSERT INTO public.hired_employees
    (sheet_row_id, vacancy_id, position_name, hired_date, employment_type, status, manager_name_sheet, source, synced_at)
  VALUES (
    NULL,
    NEW.id,
    NEW.title,
    COALESCE(NEW.closed_at, CURRENT_DATE),
    CASE WHEN NEW.status = 'closed' THEN 'employee' ELSE 'intern' END,
    CASE WHEN NEW.status = 'closed' THEN 'hired' ELSE 'probation' END,
    v_manager_name,
    'app',
    NOW()
  )
  ON CONFLICT (vacancy_id, status) WHERE source = 'app' DO UPDATE
    SET hired_date = EXCLUDED.hired_date, synced_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_hired_employee ON public.vacancies;
CREATE TRIGGER trg_auto_hired_employee
  AFTER UPDATE OF status ON public.vacancies
  FOR EACH ROW
  WHEN (NEW.status IN ('closed', 'probation') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.auto_hired_employee_on_status();

-- ── 4. Триггер: эстафета дат внутри группы позиций ───────────────────────────
CREATE OR REPLACE FUNCTION public.relay_position_group_open_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_id UUID;
BEGIN
  -- Только закрытие (closed) двигает дату. 'cancelled' не источник эстафеты.
  IF NEW.position_group_id IS NULL OR NEW.status <> 'closed' OR NEW.closed_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RETURN NEW; -- уже было закрыто, повторно не двигаем
  END IF;

  -- Следующая АКТИВНАЯ позиция группы по очереди (queue_index > закрытой).
  -- cancelled/closed/paused пропускаются (цель только status='active').
  SELECT id INTO v_next_id
  FROM public.vacancies
  WHERE position_group_id = NEW.position_group_id
    AND status = 'active'
    AND queue_index > NEW.queue_index
  ORDER BY queue_index
  LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    UPDATE public.vacancies SET opened_at = NEW.closed_at WHERE id = v_next_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_relay_position_group ON public.vacancies;
CREATE TRIGGER trg_relay_position_group
  AFTER UPDATE OF status ON public.vacancies
  FOR EACH ROW
  WHEN (NEW.position_group_id IS NOT NULL AND NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.relay_position_group_open_date();
