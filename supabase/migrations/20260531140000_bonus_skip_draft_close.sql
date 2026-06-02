-- 20260531140000_bonus_skip_draft_close.sql
-- FS-2 cross-model review P1: не начислять бонус при закрытии ЧЕРНОВИКА (draft→closed).
-- CREATE OR REPLACE (без DROP) → гранты/ACL функции не сбрасываются, SEC-001 не задет.

CREATE OR REPLACE FUNCTION public.auto_create_bonus_on_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_threshold FLOAT := 0.4;
  v_rate      RECORD;
BEGIN
  -- P1 (FS-2 review): закрытие черновика — не реальная вакансия, бонус не начисляем.
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status <> 'closed') THEN

    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := CURRENT_DATE;
    END IF;

    IF EXISTS (SELECT 1 FROM public.hr_bonuses WHERE vacancy_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    -- NULL manager_id guard — НАМЕРЕННЫЙ (0/200 безменеджерных вакансий), не трогаем.
    IF NEW.manager_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT br.position_name, br.amount_kopecks
    INTO v_rate
    FROM public.bonus_rates br
    WHERE similarity(br.position_name, NEW.title) >= v_threshold
    ORDER BY similarity(br.position_name, NEW.title) DESC, br.position_name ASC
    LIMIT 1;

    IF v_rate.position_name IS NOT NULL THEN
      INSERT INTO public.hr_bonuses (
        vacancy_id, manager_id, matched_position_name,
        bonus_amount_kopecks, bonus_date, status, source
      ) VALUES (
        NEW.id, NEW.manager_id, v_rate.position_name,
        v_rate.amount_kopecks, NEW.closed_at, 'pending', 'auto'
      );
    ELSE
      INSERT INTO public.hr_bonuses (
        vacancy_id, manager_id, matched_position_name,
        bonus_amount_kopecks, bonus_date, status, source
      ) VALUES (
        NEW.id, NEW.manager_id, NULL,
        NULL, NEW.closed_at, 'unmatched', 'unmatched'
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$function$;
