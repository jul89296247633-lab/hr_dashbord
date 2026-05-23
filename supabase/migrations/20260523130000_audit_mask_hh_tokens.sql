-- ── 20260523130000_audit_mask_hh_tokens.sql ───────────────────────────────
-- Маскирует секреты HH OAuth в audit_logs (review 4.5 🟠).
--
-- Проблема: audit_trigger_fn() пишет в audit_logs.new_values / old_values
-- цельный JSONB строки. Для user_profiles это включает hh_access_token и
-- hh_refresh_token. Аудит-журнал доступен admin'у и хранится долго — секреты
-- там лежать не должны.
--
-- Фикс: перед INSERT в audit_logs удаляем эти ключи из v_old/v_new
-- (jsonb минус оператор `-`). Никакая другая логика не меняется.
-- Идемпотентно: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID;
  v_user_role TEXT;
  v_old       JSONB;
  v_new       JSONB;
BEGIN
  -- Получаем текущего пользователя из Supabase Auth.
  BEGIN
    v_user_id := auth.uid();
    SELECT role INTO v_user_role FROM public.user_profiles WHERE id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_user_id   := NULL;
    v_user_role := 'system'; -- cron или service_role
  END;

  IF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Сохраняем только изменившиеся поля.
    SELECT jsonb_object_agg(key, value) INTO v_old
    FROM jsonb_each(to_jsonb(OLD))
    WHERE value IS DISTINCT FROM (to_jsonb(NEW))->key;

    SELECT jsonb_object_agg(key, value) INTO v_new
    FROM jsonb_each(to_jsonb(NEW))
    WHERE value IS DISTINCT FROM (to_jsonb(OLD))->key;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
  END IF;

  -- Маскирование секретов: HH OAuth tokens из user_profiles не должны
  -- попадать в audit_logs. Безопасно для любых таблиц — если ключа нет,
  -- оператор `-` просто вернёт исходный JSONB.
  IF v_old IS NOT NULL THEN
    v_old := v_old - 'hh_access_token' - 'hh_refresh_token';
  END IF;
  IF v_new IS NOT NULL THEN
    v_new := v_new - 'hh_access_token' - 'hh_refresh_token';
  END IF;

  INSERT INTO public.audit_logs
    (user_id, user_role, table_name, record_id, action, old_values, new_values)
  VALUES
    (v_user_id, COALESCE(v_user_role,'system'), TG_TABLE_NAME,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
     TG_OP, v_old, v_new);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Чистка ранее накопленных записей ─────────────────────────────────────
-- На момент применения триггер уже не пишет токены, но в audit_logs могли
-- остаться значения от старого триггера. Удаляем ключи из обоих JSONB-полей.
-- Идемпотентно: повторный запуск миграции просто ничего не найдёт (оператор `-`
-- на JSONB без ключа возвращает исходный объект). Ограничено table_name='user_profiles'
-- — единственная таблица, где эти поля встречаются.
UPDATE public.audit_logs
SET
  new_values = new_values - 'hh_access_token' - 'hh_refresh_token',
  old_values = old_values - 'hh_access_token' - 'hh_refresh_token'
WHERE table_name = 'user_profiles'
  AND (
    (new_values ? 'hh_access_token') OR (new_values ? 'hh_refresh_token') OR
    (old_values ? 'hh_access_token') OR (old_values ? 'hh_refresh_token')
  );
