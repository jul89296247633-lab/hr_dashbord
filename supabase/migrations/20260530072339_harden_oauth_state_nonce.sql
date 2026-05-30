-- ════════════════════════════════════════════════════════════════════════════
-- SEC-007: session-bound nonce для OAuth HH (CSRF-защита authorization_code flow)
--
-- Проблема: раньше state = manager_id (предсказуемый UUID), callback без сессии.
-- Решение: одноразовый случайный nonce. Связку nonce -> manager_id храним здесь
-- (server-side), а сам nonce — в httpOnly-cookie браузера-инициатора. Callback
-- сверяет state(URL) == nonce(cookie) И достаёт manager_id из этой таблицы.
--
-- Доступ: ТОЛЬКО service_role (оба роута OAuth используют createAdminClient,
--   обходящий RLS). RLS включён, политик НЕТ → anon/authenticated доступа не имеют
--   (deny-by-default). Advisor покажет INFO «RLS enabled no policy» — это намеренно.
--
-- TTL-очистка устаревших nonce (pg_cron в проекте НЕ включён — зависимость не вводим):
--   1) callback удаляет ИСПОЛЬЗОВАННЫЙ nonce сразу (одноразовость);
--   2) start перед вставкой делает DELETE WHERE expires_at < now() (оппортунистично).
--   Таблица крошечная (OAuth инициирует только admin); индекс по expires_at — для
--   быстрого DELETE. Этого достаточно, pg_cron не требуется.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.hh_oauth_states (
  nonce       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

-- Индекс для оппортунистической TTL-очистки (DELETE WHERE expires_at < now()).
CREATE INDEX idx_hh_oauth_states_expires ON public.hh_oauth_states (expires_at);

-- RLS включён, политик нет → только service_role (createAdminClient) обходит RLS.
ALTER TABLE public.hh_oauth_states ENABLE ROW LEVEL SECURITY;
