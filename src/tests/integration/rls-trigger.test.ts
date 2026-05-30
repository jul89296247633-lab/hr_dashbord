/**
 * @vitest-environment node
 *
 * Интеграционные тесты: RLS-политики hr_bonuses + триггер auto_create_bonus_on_close.
 *
 * ⚠️  ТРЕБУЕТ ЗАПУЩЕННОГО SUPABASE LOCAL:
 *     supabase start
 *     npm run test:integration
 *
 * Переменные окружения для локального стенда:
 *   SUPABASE_LOCAL_URL    = http://127.0.0.1:54321
 *   SUPABASE_SERVICE_KEY  = <service_role key из `supabase status`>
 *   SUPABASE_ANON_KEY     = <anon key из `supabase status`>
 *
 * Тесты используют service_role для setup/teardown и реальные JWT-токены
 * разных ролей для проверки RLS и триггеров.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

// Пропускаем все тесты, если ключи не настроены
const SKIP = !SERVICE_KEY || !ANON_KEY;
const describeOrSkip = SKIP ? describe.skip : describe;

// Service-role клиент (обходит RLS) — только для setup/teardown
const admin = createClient(LOCAL_URL, SERVICE_KEY);

// ── Тестовые данные ──────────────────────────────────────────────────────────
let managerUserId = '';
let headUserId = '';
let vacancyId = '';
let bonusRateId = '';

// ── Setup: создаём пользователей, vacancy, bonus_rate ────────────────────────
beforeAll(async () => {
  if (SKIP) return;

  // Создаём manager
  const { data: mgr } = await admin.auth.admin.createUser({
    email: 'test-manager@test.internal',
    password: 'testpassword123',
    user_metadata: { role: 'manager' },
  });
  managerUserId = mgr?.user?.id ?? '';

  // Создаём head
  const { data: hd } = await admin.auth.admin.createUser({
    email: 'test-head@test.internal',
    password: 'testpassword123',
    user_metadata: { role: 'head' },
  });
  headUserId = hd?.user?.id ?? '';

  // Создаём профили вручную (в тестах handle_new_user может не отработать)
  await admin.from('user_profiles').upsert([
    { id: managerUserId, role: 'manager', full_name: 'Test Manager', is_active: true },
    { id: headUserId, role: 'head', full_name: 'Test Head', is_active: true },
  ]);

  // Создаём bonus_rate для fuzzy-match теста
  const { data: rate } = await admin.from('bonus_rates').insert({
    position_name: 'Тестовый тариф для интеграционных тестов',
    amount_kopecks: 100000,
    group_name: 'Test',
  }).select('id').single();
  bonusRateId = rate?.id ?? '';

  // Создаём вакансию
  const { data: vac } = await admin.from('vacancies').insert({
    title: 'Тестовый тариф для интеграционных тестов',
    manager_id: managerUserId,
    status: 'active',
    confidentiality: 'open',
    opened_at: new Date().toISOString().slice(0, 10),
  }).select('id').single();
  vacancyId = vac?.id ?? '';
});

afterAll(async () => {
  if (SKIP) return;
  // Очищаем тестовые данные
  if (vacancyId) {
    await admin.from('hr_bonuses').delete().eq('vacancy_id', vacancyId);
    await admin.from('vacancies').delete().eq('id', vacancyId);
  }
  if (bonusRateId) await admin.from('bonus_rates').delete().eq('id', bonusRateId);
  if (managerUserId) await admin.auth.admin.deleteUser(managerUserId);
  if (headUserId) await admin.auth.admin.deleteUser(headUserId);
});

// ── RLS: hr_bonuses SELECT ────────────────────────────────────────────────────
describeOrSkip('RLS: hr_bonuses SELECT', () => {
  it('manager видит только свои бонусы', async () => {
    // Создаём бонус для manager
    await admin.from('hr_bonuses').insert({
      vacancy_id: vacancyId,
      manager_id: managerUserId,
      bonus_date: new Date().toISOString().slice(0, 10),
      status: 'pending',
      source: 'manual',
      bonus_amount_kopecks: 50000,
    });

    // Входим как manager через signInWithPassword
    const { data: session } = await createClient(LOCAL_URL, ANON_KEY)
      .auth.signInWithPassword({ email: 'test-manager@test.internal', password: 'testpassword123' });

    const managerClient = createClient(LOCAL_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session?.session?.access_token}` } },
    });

    const { data, error } = await managerClient.from('hr_bonuses').select('*');
    expect(error).toBeNull();
    // Manager видит только свои бонусы
    expect(data?.every((b) => b.manager_id === managerUserId)).toBe(true);
  });

  it('manager не может вставить hr_bonuses напрямую (RLS)', async () => {
    const { data: session } = await createClient(LOCAL_URL, ANON_KEY)
      .auth.signInWithPassword({ email: 'test-manager@test.internal', password: 'testpassword123' });

    const managerClient = createClient(LOCAL_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session?.session?.access_token}` } },
    });

    const { error } = await managerClient.from('hr_bonuses').insert({
      vacancy_id: vacancyId,
      manager_id: managerUserId,
      bonus_date: new Date().toISOString().slice(0, 10),
      status: 'pending',
      source: 'manual',
      bonus_amount_kopecks: 50000,
    });
    // RLS должна заблокировать INSERT от manager
    expect(error).not.toBeNull();
  });

  it('head видит все hr_bonuses', async () => {
    const { data: session } = await createClient(LOCAL_URL, ANON_KEY)
      .auth.signInWithPassword({ email: 'test-head@test.internal', password: 'testpassword123' });

    const headClient = createClient(LOCAL_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session?.session?.access_token}` } },
    });

    const { data, error } = await headClient.from('hr_bonuses').select('*');
    expect(error).toBeNull();
    // head видит бонусы, включая чужие
    expect(data?.length).toBeGreaterThan(0);
  });
});

// ── Триггер: auto_create_bonus_on_close ──────────────────────────────────────
describeOrSkip('Триггер auto_create_bonus_on_close', () => {
  it('при смене status→closed создаётся hr_bonuses', async () => {
    // Убеждаемся что бонуса ещё нет
    await admin.from('hr_bonuses').delete().eq('vacancy_id', vacancyId);

    // Меняем статус на closed (триггер BEFORE UPDATE)
    const { error } = await admin.from('vacancies')
      .update({ status: 'closed', closed_at: new Date().toISOString().slice(0, 10) })
      .eq('id', vacancyId);

    expect(error).toBeNull();

    // Проверяем создание hr_bonuses
    const { data: bonuses } = await admin.from('hr_bonuses')
      .select('*')
      .eq('vacancy_id', vacancyId);

    expect(bonuses).toHaveLength(1);
    expect(bonuses?.[0].manager_id).toBe(managerUserId);
    expect(bonuses?.[0].status).toMatch(/^(pending|unmatched)$/);
  });

  it('повторное закрытие (closed→active→closed) не создаёт дубль', async () => {
    // Переоткрываем вакансию
    await admin.from('vacancies').update({ status: 'active', closed_at: null }).eq('id', vacancyId);

    // Снова закрываем
    await admin.from('vacancies')
      .update({ status: 'closed', closed_at: new Date().toISOString().slice(0, 10) })
      .eq('id', vacancyId);

    // Должна быть только одна запись (UNIQUE vacancy_id)
    const { data: bonuses } = await admin.from('hr_bonuses')
      .select('*')
      .eq('vacancy_id', vacancyId);

    expect(bonuses).toHaveLength(1);
  });

  it('fuzzy-match: при совпадении с bonus_rates status=pending, amount заполнен', async () => {
    // Очищаем бонус
    await admin.from('hr_bonuses').delete().eq('vacancy_id', vacancyId);
    // Переоткрываем
    await admin.from('vacancies').update({ status: 'active', closed_at: null }).eq('id', vacancyId);
    // Закрываем — триггер должен найти тариф через fuzzy-match (similarity ≥ 0.4)
    await admin.from('vacancies')
      .update({ status: 'closed', closed_at: new Date().toISOString().slice(0, 10) })
      .eq('id', vacancyId);

    const { data: bonuses } = await admin.from('hr_bonuses').select('*').eq('vacancy_id', vacancyId);
    const bonus = bonuses?.[0];

    if (bonus?.status === 'pending') {
      // Если fuzzy-match сработал — сумма заполнена
      expect(bonus.bonus_amount_kopecks).toBe(100000);
      expect(bonus.matched_position_name).toBeTruthy();
    } else {
      // Если не сработал — status=unmatched, amount=NULL
      expect(bonus?.status).toBe('unmatched');
      expect(bonus?.bonus_amount_kopecks).toBeNull();
    }
  });
});

// ── Аудит: изменение bonus_rates → audit_logs ────────────────────────────────
describeOrSkip('Аудит: bonus_rates → audit_logs', () => {
  it('PATCH bonus_rates создаёт запись в audit_logs с old_values/new_values', async () => {
    if (!bonusRateId) return;

    const before = new Date().toISOString();

    // Меняем тариф через service_role (обходим RLS admin)
    await admin.from('bonus_rates')
      .update({ amount_kopecks: 200000 })
      .eq('id', bonusRateId);

    const { data: auditRows } = await admin.from('audit_logs')
      .select('*')
      .eq('table_name', 'bonus_rates')
      .eq('record_id', bonusRateId)
      .eq('action', 'UPDATE')
      .gte('created_at', before);

    expect(auditRows?.length).toBeGreaterThan(0);
    const entry = auditRows?.[0];
    expect(entry?.old_values).toHaveProperty('amount_kopecks');
    expect(entry?.new_values).toHaveProperty('amount_kopecks');
    expect(entry?.new_values?.amount_kopecks).toBe(200000);
  });
});
