-- Уникальный добавочный Манго на пользователя.
-- Partial index: NULL-значения не конфликтуют (у менеджеров без Mango — extension IS NULL).
-- Проверено запросом до применения: дублей нет (6 записей, все cnt=1).
CREATE UNIQUE INDEX idx_user_profiles_mango_ext_unique
  ON public.user_profiles (mango_extension)
  WHERE mango_extension IS NOT NULL;

COMMENT ON INDEX idx_user_profiles_mango_ext_unique
  IS 'Один добавочный Mango ВАТС на пользователя. sync-mango.ts использует extension как ключ — дубль приведёт к задвоению звонков.';
