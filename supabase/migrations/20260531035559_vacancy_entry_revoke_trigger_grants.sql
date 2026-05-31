-- ════════════════════════════════════════════════════════════════════════════
-- Фикс к 20260530165725_vacancy_entry: отзыв EXECUTE у триггер-функций.
--
-- Verification (get_advisors) после применения vacancy_entry показал НОВЫЙ WARN:
-- auto_hired_employee_on_status() и relay_position_group_open_date() (SECURITY
-- DEFINER) получили дефолтный PUBLIC EXECUTE → вызываемы anon/authenticated через
-- REST RPC. Это триггер-функции — прямой вызов не нужен никому, кроме owner;
-- срабатывание триггера от EXECUTE-привилегии НЕ зависит. Отзываем (как SEC-003
-- для handle_new_user/audit_trigger_fn/auto_create_bonus_on_close).
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.auto_hired_employee_on_status()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.relay_position_group_open_date()  FROM PUBLIC, anon, authenticated;
