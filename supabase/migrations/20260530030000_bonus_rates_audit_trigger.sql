-- Добавляем audit-триггер на bonus_rates для истории изменений тарифов.
-- Нужен для GET /api/admin/bonus-rates/[id]/history.
CREATE TRIGGER audit_bonus_rates
  AFTER INSERT OR UPDATE OR DELETE ON public.bonus_rates
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
