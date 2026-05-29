# Feature: Бонусы HR + Sheets-style админ вакансий

> **Проект:** HR Control Tower
> **Дата:** 2026-05-29
> **Приоритет:** High
> **Оценка:** 2 дня
> **Спека объединяет две связанные части — обе нужны для замены Google Sheets Data:**
> A) Авторасчёт бонусов при закрытии вакансии + редактор тарифов
> B) Sheets-style админская таблица вакансий с inline-редактированием статуса

---

## 1. User Stories

### US-A-001: Автоматическое начисление бонуса при закрытии вакансии

**Как** admin/head HR,
**я хочу** что при изменении статуса вакансии на «закрыта» бонус её менеджеру создавался автоматически,
**чтобы** не вести двойной учёт в Sheets и системе.

**Сценарий:**
1. Admin открывает `/vacancies/admin` или `/vacancies/[id]/edit`
2. Меняет `status` с `active` на `closed`, указывает `closed_at` = сегодня
3. Сохраняет → срабатывает триггер `auto_create_bonus_on_close`
4. Триггер ищет тариф в `bonus_rates` через fuzzy-match `similarity(vacancies.title, bonus_rates.position_name) >= 0.4`
5. Создаёт запись `hr_bonuses`: vacancy_id, manager_id, amount_kopecks, bonus_date=closed_at, status='pending', matched_position_name (snapshot тарифа)
6. Менеджер видит начисление в `/bonuses`

### US-A-002: Несопоставленные бонусы

**Как** HR,
**я хочу** видеть закрытые вакансии без подобранного тарифа и привязывать их вручную,
**чтобы** ничего не пропустить.

**Сценарий:**
1. Вакансия «Главный архитектор продаж» закрывается — в bonus_rates похожего тарифа нет (similarity < 0.4)
2. Триггер создаёт hr_bonuses со status='unmatched', amount_kopecks=NULL
3. На /bonuses admin видит секцию «Без сопоставления» с этим начислением
4. Кликает «Привязать тариф» — выбирает из dropdown — запись обновляется со status='pending'

### US-A-003: Редактирование справочника тарифов

**Как** admin,
**я хочу** управлять тарифами бонусов в одной таблице с историей изменений,
**чтобы** видеть кто менял тариф и когда.

**Сценарий:**
1. Открывает /admin/bonuses — таблица: должность, сумма (рубли), последнее изменение, кто менял
2. Кнопка «Добавить тариф» — форма (должность, сумма)
3. Кнопка «История» рядом со строкой — модал со всеми изменениями из audit_logs
4. Кнопка «Импорт XLSX» — переиспользует мастер онбординга для шаблона «Бонусы_HR»
5. Изменение тарифа НЕ пересчитывает ранее начисленные бонусы (тариф зафиксирован на момент закрытия вакансии)

### US-B-001: Sheets-style таблица всех вакансий

**Как** admin/head,
**я хочу** видеть все вакансии в широкой таблице как в Google Sheets data,
**чтобы** инлайн менять статус и закрывать вакансии без перехода на детальную страницу.

**Сценарий:**
1. Открывает /vacancies/admin — таблица со всеми колонками:
   ID (короткий) / Название / Подразделение / Город / Менеджер / Статус / Тип / HH ID / internal_ref / Открыта / Закрыта / Дней
2. Фильтры сверху: статус, тип (open/confidential), город, менеджер
3. Поиск по названию (live filter)
4. На каждой строке dropdown «Статус» — admin меняет — если выбрал closed, появляется DatePicker для closed_at — подтверждает — бонус создаётся
5. Inline edit названия, города, менеджера (двойной клик — input — Enter сохраняет)
6. Кнопка «Экспорт CSV» — выгрузка отфильтрованного списка

### US-B-002: Создание вакансии вручную admin'ом

**Как** admin,
**я хочу** добавить вакансию напрямую (без процесса заявки),
**чтобы** быстро завести существующую вакансию которой нет в системе.

**Сценарий:**
1. На /vacancies/admin кнопка «Добавить вакансию» — форма (название, город, менеджер, тип open/conf, HH ID опц., дата открытия, статус)
2. Сохраняет — запись создаётся со статусом из формы
3. Если выбрана конфиденциальная — генерится internal_ref (как в /requests)
4. Бонус НЕ создаётся (вакансия не закрыта)

### Критерии приёмки

- [ ] При смене vacancies.status на 'closed' создаётся hr_bonuses автоматически
- [ ] Триггер работает для всех путей: ручное закрытие, API, sheets-sync
- [ ] Несопоставленные начисления имеют status='unmatched', amount=NULL, HR может привязать вручную
- [ ] /admin/bonuses доступна только admin, тарифы видят все авторизованные
- [ ] История изменений тарифов в модале через audit_logs
- [ ] /vacancies/admin показывает все вакансии (open + confidential + draft), inline edit статуса работает
- [ ] Manager не имеет доступа к /vacancies/admin (head/admin/executive)
- [ ] Изменение тарифа не пересчитывает старые начисления
- [ ] При смене статуса с closed обратно на active существующий бонус НЕ удаляется (требует ручного удаления — для аудита)
- [ ] Все действия пишутся в audit_logs

---

## 2. Изменения в базе данных

### Новая таблица: hr_bonuses (создаём заново — была дропнута на D-1a)

```sql
CREATE TABLE public.hr_bonuses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id              UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT,
  manager_id              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  matched_position_name   TEXT,
  bonus_amount_kopecks    INTEGER CHECK (bonus_amount_kopecks IS NULL OR bonus_amount_kopecks >= 0),
  bonus_date              DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'unmatched', 'paid', 'cancelled')),
  source                  TEXT NOT NULL DEFAULT 'auto'
                            CHECK (source IN ('auto', 'manual', 'unmatched')),
  matched_by              UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  paid_by                 UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vacancy_id)
);

CREATE INDEX idx_bonuses_manager_id ON public.hr_bonuses(manager_id);
CREATE INDEX idx_bonuses_status     ON public.hr_bonuses(status);
CREATE INDEX idx_bonuses_date_desc  ON public.hr_bonuses(bonus_date DESC);

ALTER TABLE public.hr_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bonuses_select" ON public.hr_bonuses
  FOR SELECT USING (
    manager_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin', 'executive')
    )
  );

CREATE POLICY "bonuses_insert_head" ON public.hr_bonuses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

CREATE POLICY "bonuses_update_head" ON public.hr_bonuses
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('head', 'admin')
    )
  );

CREATE TRIGGER hr_bonuses_updated_at
  BEFORE UPDATE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_hr_bonuses
  AFTER INSERT OR UPDATE OR DELETE ON public.hr_bonuses
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
```

### Триггер auto_create_bonus_on_close

```sql
CREATE OR REPLACE FUNCTION public.auto_create_bonus_on_close()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_threshold FLOAT := 0.4;
  v_rate RECORD;
BEGIN
  -- Срабатывает только при переходе в 'closed'
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status <> 'closed') THEN
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := CURRENT_DATE;
    END IF;

    -- Не создаём дубль
    IF EXISTS (SELECT 1 FROM public.hr_bonuses WHERE vacancy_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    -- Fuzzy match
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
$$;

CREATE TRIGGER trg_auto_create_bonus_on_close
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_bonus_on_close();
```

### bonus_rates — проверки

Не пересоздаём. Только проверить:
- RLS чтение всем (есть)
- RLS запись только admin (если сейчас head/admin — ужесточить до admin)
- audit_trigger_fn существует

---

## 3. API эндпоинты

### Бонусы (часть A)

- `GET /api/bonuses?status=all|pending|unmatched|paid` — расширить
- `PATCH /api/bonuses/[id]/match` — привязка тарифа к unmatched, head/admin
- `PATCH /api/bonuses/[id]/mark-paid` — пометка выплаченным, admin
- `DELETE /api/bonuses/[id]` — удаление (для аудита, admin)

### Тарифы (часть A)

- `GET /api/admin/bonus-rates` — список, head/admin
- `POST /api/admin/bonus-rates` — создание, admin
- `PATCH /api/admin/bonus-rates/[id]` — изменение, admin
- `DELETE /api/admin/bonus-rates/[id]` — удаление, admin
- `GET /api/admin/bonus-rates/[id]/history` — история из audit_logs, admin

### Админская таблица вакансий (часть B)

- `GET /api/vacancies/admin?status=&type=&city=&manager_id=&search=&page=&per_page=50` — head/admin/executive
- `PATCH /api/vacancies/[id]` — расширить (inline edit title/location/manager_id/status/closed_at), head/admin
- `POST /api/vacancies` — расширить (создание admin'ом напрямую, с генерацией internal_ref для confidential)

---

## 4. UI компоненты

### /admin/bonuses — новая страница

- Шапка: «Тарифы бонусов HR» + Кнопка «Добавить» + Кнопка «Импорт XLSX»
- Таблица: Должность | Сумма (₽) | Изменён | Действия
- Действия: Edit (inline) | History (модал) | Trash
- Модал «История изменений» — таймлайн из audit_logs

### /vacancies/admin — новая страница

**Структура:**
- Шапка: «Все вакансии» + Кнопка «Добавить» + Кнопка «Экспорт CSV»
- Фильтры (sticky): Статус | Тип | Город | Менеджер | Поиск
- Таблица (широкая, горизонтальный скролл на mobile)

**Колонки:**
| Колонка | Inline edit |
|---|---|
| ID (короткий) | — |
| Название | да (двойной клик) |
| Подразделение | да |
| Город | да (autocomplete) |
| Менеджер | да (select) |
| Статус | да (select + DatePicker при closed) |
| Тип (open/conf) | — |
| HH ID | только при создании |
| Внутр. ref (CONF-2026-NNNN) | — |
| Открыта | — |
| Закрыта | да (при закрытии) |
| Дней | computed |

**Поведение inline edit статуса:**
1. Клик dropdown — список статусов
2. Выбор «Закрыта» — появляется DatePicker (default: сегодня)
3. После выбора даты — toast «Закрыто, бонус начислен»
4. Если отменено — статус не меняется

### /bonuses — расширение

- Таб «Без сопоставления» (status=unmatched)
- На unmatched-бонусе кнопка «Привязать тариф» — модал со списком rates
- Для admin — кнопка «Пометить как выплачено» на pending

### Sidebar (nav.ts)

- Пункт «Тарифы (admin)» под «Бонусы HR» — admin → /admin/bonuses
- Пункт «Все вакансии (admin)» под «Вакансии» — head/admin/executive → /vacancies/admin

---

## 5. Бизнес-логика

### Fuzzy-match

`pg_trgm` similarity >= 0.4 (тот же порог что в compute_manager_bonuses и compute_staffing_plan — единый по проекту).

### Snapshot тарифа

`matched_position_name` сохраняется на момент срабатывания триггера. Изменение `bonus_rates` НЕ пересчитывает существующие `hr_bonuses`. Аудит-консистентность.

### Уникальность бонуса

`UNIQUE (vacancy_id)` — один бонус на закрытие. При повторном закрытии (closed → active → closed) триггер видит существующую запись и не создаёт дубль.

### Удаление бонуса при отмене закрытия

При смене status с closed на другой — бонус остаётся. Только явное DELETE через UI/API удаляет.

---

## 6. Edge Cases

- **EC-1: Закрытие через sheets-sync.** Триггер срабатывает на любое UPDATE. Бонус создаётся. Унифицированное поведение.
- **EC-2: Тарифы с одинаковой similarity.** `ORDER BY similarity DESC, position_name ASC LIMIT 1` — детерминированно.
- **EC-3: Удаление тарифа с привязанными бонусами.** Можно — matched_position_name это snapshot, не FK.
- **EC-4: Гонка в inline edit.** Оптимистичное UI + перезагрузка строки после ответа. Последний выигрывает.
- **EC-5: Manager заходит на /admin/bonuses.** Server component делает `requireRole(['admin'])` — редирект.
- **EC-6: Executive в /vacancies/admin.** Колонка «Менеджер» пустая, tooltip «Скрыто для роли руководителя».
- **EC-7: Закрытая phantom-вакансия (без sheet_row и без internal_ref).** Триггер всё равно создаёт бонус по title.
- **EC-8: Импорт XLSX поверх существующих тарифов.** UNIQUE по position_name — UPDATE при совпадении (механизм уже работает в /onboarding).

---

## 7. Миграции (порядок)

```
20260530000000_recreate_hr_bonuses.sql      # таблица hr_bonuses заново
20260530010000_auto_bonus_trigger.sql       # триггер на vacancies
20260530020000_bonus_rates_admin_only.sql   # ужесточить RLS если head может писать
```

---

## 8. План реализации (по блокам)

**Блок 1 — БД:** миграции (hr_bonuses, триггер, RLS проверка)

**Блок 2 — API:** bonus-rates CRUD, /bonuses/[id]/match, /bonuses/[id]/mark-paid, /vacancies/admin

**Блок 3 — UI:** /admin/bonuses, /vacancies/admin, расширение /bonuses, sidebar

**Блок 4 — тесты:** закрытие → бонус, unmatched → ручная привязка, изменение тарифа не ломает старые, ролевая защита

---

## 9. Зависимости и связь с другими спеками

- **Закрывает MIGRATION_PLAN B1** (Бонусы)
- **Частично закрывает B2** (Управление наймами через закрытие в /vacancies/admin), но `hired_employees` UI остаётся для спеки 5
- **После этой фичи можно делать D-1b** (отключить блок тарифов в sync/sheets)
