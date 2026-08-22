-- 20260817130000_hh_phone_calls.sql
-- Сырые HH call-tracking события из коллекции negotiations/phone_calls.
-- Пишутся только service_role синхронизацией; пользователи читают агрегаты через
-- существующие vacancy_snapshots.calls_count и дашборды.

CREATE TABLE IF NOT EXISTS public.hh_phone_calls (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hh_call_id                 TEXT NOT NULL,
  vacancy_id                 UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  hh_vacancy_id              TEXT NOT NULL,
  manager_id                 UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  negotiation_id             TEXT,
  status                     TEXT NOT NULL,
  creation_time              TIMESTAMPTZ NOT NULL,
  last_change_time           TIMESTAMPTZ,
  duration_seconds           INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  picked_up_phone_by_opponent BOOLEAN,
  raw_json                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hh_call_id)
);

CREATE INDEX IF NOT EXISTS idx_hh_phone_calls_vacancy_time
  ON public.hh_phone_calls (vacancy_id, creation_time DESC);

CREATE INDEX IF NOT EXISTS idx_hh_phone_calls_manager_time
  ON public.hh_phone_calls (manager_id, creation_time DESC)
  WHERE manager_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hh_phone_calls_status
  ON public.hh_phone_calls (status);

ALTER TABLE public.hh_phone_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hh_phone_calls_select" ON public.hh_phone_calls;
CREATE POLICY "hh_phone_calls_select" ON public.hh_phone_calls
  FOR SELECT
  USING (
    manager_id = auth.uid()
    OR public.get_my_role() IN ('head', 'admin')
  );

DROP TRIGGER IF EXISTS hh_phone_calls_updated_at ON public.hh_phone_calls;
CREATE TRIGGER hh_phone_calls_updated_at
  BEFORE UPDATE ON public.hh_phone_calls
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
