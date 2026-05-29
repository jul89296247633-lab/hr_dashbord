-- ════════════════════════════════════════════════════════════════════════
-- 20260530010000_auto_bonus_trigger.sql
--
-- Триггер auto_create_bonus_on_close.
-- Срабатывает BEFORE UPDATE на vacancies при переходе status → 'closed'.
-- SECURITY DEFINER: пишет в hr_bonuses минуя RLS (нужно для sheets-sync
-- и других сервисных путей которые не проходят auth check).
--
-- Логика:
-- 1. Срабатывает только при NEW.status='closed' && OLD.status <> 'closed'
-- 2. Если closed_at не задан — ставим CURRENT_DATE
-- 3. Проверяем UNIQUE (vacancy_id) — дубль не создаём
-- 4. Fuzzy-match по bonus_rates (pg_trgm similarity >= 0.4)
--    → нашли: status='pending', amount=тариф, matched_position_name=snapshot
--    → не нашли: status='unmatched', amount=NULL
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_create_bonus_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_threshold FLOAT := 0.4;
  v_rate      RECORD;
BEGIN
  -- Только переход в closed
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status <> 'closed') THEN

    -- Установить closed_at если не задан
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := CURRENT_DATE;
    END IF;

    -- Не создаём дубль (UNIQUE vacancy_id — страховка на уровне логики)
    IF EXISTS (SELECT 1 FROM public.hr_bonuses WHERE vacancy_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    -- Нет менеджера — не создаём (draft/confidential без manager_id)
    IF NEW.manager_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Fuzzy-match: берём лучший тариф (детерминировано через position_name ASC)
    SELECT br.position_name, br.amount_kopecks
    INTO v_rate
    FROM public.bonus_rates br
    WHERE similarity(br.position_name, NEW.title) >= v_threshold
    ORDER BY similarity(br.position_name, NEW.title) DESC, br.position_name ASC
    LIMIT 1;

    IF v_rate.position_name IS NOT NULL THEN
      -- Тариф найден → pending
      INSERT INTO public.hr_bonuses (
        vacancy_id, manager_id, matched_position_name,
        bonus_amount_kopecks, bonus_date, status, source
      ) VALUES (
        NEW.id, NEW.manager_id, v_rate.position_name,
        v_rate.amount_kopecks, NEW.closed_at, 'pending', 'auto'
      );
    ELSE
      -- Тариф не найден → unmatched (HR привяжет вручную)
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
$$;

CREATE TRIGGER trg_auto_create_bonus_on_close
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_bonus_on_close();
