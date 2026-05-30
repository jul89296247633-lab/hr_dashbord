-- ════════════════════════════════════════════════════════════════════════════
-- Impersonation («вход как менеджер») — аудит + server-authoritative сессия.
-- См. FEATURE_SPEC_impersonation.md.
--
-- impersonation_logs одновременно:
--   • журнал аудита (кто, кого, когда, чем закончилось, ip/ua);
--   • источник истины активной сессии overlay (cookie impersonate_sid = этой строки id).
--     Overlay в getAuthContext активен ТОЛЬКО при незакрытой непросроченной записи —
--     поэтому stop (ended_at) и expiry (started_at+TTL) авторитетны на сервере, а не cookie.
--
-- Доступ: SELECT — только admin (как audit_logs); запись (start/stop/expiry) — service_role
--   (createAdminClient, обход RLS). RLS включён → anon/authenticated/manager доступа не имеют.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.impersonation_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonator_id   uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  impersonator_role text NOT NULL,                        -- 'admin' | 'head' на момент старта
  target_manager_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,                          -- NULL = сессия активна
  end_reason        text,                                 -- 'manual' | 'expired' | NULL(активна)
  ip_address        text,
  user_agent        text
);

-- Поиск активной сессии impersonator'а (overlay-lookup и stop).
CREATE INDEX idx_impersonation_logs_active
  ON public.impersonation_logs (impersonator_id) WHERE ended_at IS NULL;
-- История по impersonator'у (аудит).
CREATE INDEX idx_impersonation_logs_history
  ON public.impersonation_logs (impersonator_id, started_at DESC);

-- RLS: SELECT только admin (оверсайт), запись — service_role (обход RLS).
ALTER TABLE public.impersonation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY impersonation_logs_admin_select ON public.impersonation_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );
