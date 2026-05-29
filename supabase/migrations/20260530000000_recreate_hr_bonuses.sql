-- ════════════════════════════════════════════════════════════════════════
-- 20260530000000_recreate_hr_bonuses.sql
--
-- Воссоздаём таблицу hr_bonuses по спеке FS-2.
-- Ранее (20260529040000) таблица была дропнута — она была пустой и
-- нигде не использовалась. Теперь создаём правильную версию:
-- UNIQUE (vacancy_id) — один бонус на закрытие.
-- matched_position_name — snapshot тарифа на момент закрытия.
-- status: pending | unmatched | paid | cancelled.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE public.hr_bonuses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id              UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT,
  manager_id              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  -- Snapshot названия тарифа на момент срабатывания триггера.
  -- Изменение bonus_rates после закрытия НЕ пересчитывает этот бонус.
  matched_position_name   TEXT,
  bonus_amount_kopecks    INTEGER CHECK (bonus_amount_kopecks IS NULL OR bonus_amount_kopecks >= 0),
  bonus_date              DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'unmatched', 'paid', 'cancelled')),
  source                  TEXT NOT NULL DEFAULT 'auto'
                            CHECK (source IN ('auto', 'manual', 'unmatched')),
  -- Кто вручную привязал тариф (для status='unmatched' → 'pending')
  matched_by              UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- Кто пометил как выплаченный
  paid_by                 UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Один бонус на закрытие вакансии
  UNIQUE (vacancy_id)
);

CREATE INDEX idx_hr_bonuses_manager_id ON public.hr_bonuses(manager_id);
CREATE INDEX idx_hr_bonuses_status     ON public.hr_bonuses(status);
CREATE INDEX idx_hr_bonuses_date_desc  ON public.hr_bonuses(bonus_date DESC);

ALTER TABLE public.hr_bonuses ENABLE ROW LEVEL SECURITY;

-- Менеджер видит свои бонусы; head/admin/executive — все
CREATE POLICY "bonuses_select" ON public.hr_bonuses
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
    )
  );

-- head/admin создают (ручная привязка, триггер пишет через SECURITY DEFINER)
CREATE POLICY "bonuses_insert_head" ON public.hr_bonuses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- head/admin обновляют (match, mark-paid, cancel)
CREATE POLICY "bonuses_update_head" ON public.hr_bonuses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

-- Удаление — только admin (для аудита, явное действие)
CREATE POLICY "bonuses_delete_admin" ON public.hr_bonuses
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );

CREATE TRIGGER hr_bonuses_updated_at
  BEFORE UPDATE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_hr_bonuses
  AFTER INSERT OR UPDATE OR DELETE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
