/**
 * @vitest-environment node
 *
 * RLS-изоляция (Группы 1/2/4 по docs/RLS_TEST_PLAN.md).
 *
 * ⚠️  ТРЕБУЕТ ЗАПУЩЕННОГО ЛОКАЛЬНОГО STACK'А (Docker):
 *     supabase start
 *     npm run test:integration
 *
 * Каркас (raw SQL через pg, НЕ supabase-js — нужен SET LOCAL ROLE):
 *   BEGIN
 *   → seed под суперюзером postgres (обходит RLS): 2 manager (auth.users + user_profiles) + бонусы
 *   → SET LOCAL ROLE authenticated + request.jwt.claims '{"sub":<id>,"role":"authenticated"}'
 *     (так RLS видит auth.uid()=sub; get_my_role() читает user_profiles по этому id)
 *   → SELECT под ролью manager1 → assert изоляция
 *   → ROLLBACK (ничего не оседает на стенде)
 *
 * Подключение: SUPABASE_DB_URL или дефолт локального стенда (порт 54322).
 * Если Postgres недоступен (стек не поднят) — тест помечается skipped, не падает.
 *
 * ЭТО ПЕРВЫЙ ТЕСТ — валидация каркаса. После зелёного прогона масштабируем на
 * Группы 1/2/4 (см. план). НЕ дублировать executive-pii.test.ts (API-слой, Группа 3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pool: Pool;
let reachable = false;

beforeAll(async () => {
  pool = new Pool({ connectionString: DB_URL, connectionTimeoutMillis: 3000, max: 2 });
  try {
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
    reachable = true;
  } catch {
    reachable = false; // стек не поднят → все тесты ниже сами себя skip-нут
  }
});

afterAll(async () => {
  await pool?.end();
});

/** Сидит auth.users + user_profiles под postgres (до SET LOCAL ROLE). */
async function seedUser(client: PoolClient, id: string, role: string, fullName: string) {
  await client.query(
    `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, '', now(), now(), now())`,
    [id, `${id}@test.internal`],
  );
  // Триггер handle_new_user (на auth.users) уже создаёт user_profiles с дефолтной
  // ролью 'manager'. Upsert устойчив в обоих случаях: триггер есть (обновим роль/имя)
  // или нет (вставим сами).
  await client.query(
    `INSERT INTO public.user_profiles (id, role, full_name, email, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (id) DO UPDATE
       SET role = EXCLUDED.role,
           full_name = EXCLUDED.full_name,
           email = EXCLUDED.email,
           is_active = true`,
    [id, role, fullName, `${id}@test.internal`],
  );
}

/** Переключает транзакцию в контекст authenticated-пользователя с заданным auth.uid(). */
async function actAs(client: PoolClient, userId: string) {
  await client.query('SET LOCAL ROLE authenticated');
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
}

describe('RLS изоляция: hr_bonuses (Группа 1 — деньги/PII)', () => {
  it('manager1 видит свои бонусы и НЕ видит бонусы manager2', async (ctx) => {
    if (!reachable) {
      ctx.skip(); // Postgres недоступен — стек не поднят
      return;
    }

    const m1 = crypto.randomUUID();
    const m2 = crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── seed под postgres (RLS обходится) ──────────────────────────────────
      await seedUser(client, m1, 'manager', 'Manager One');
      await seedUser(client, m2, 'manager', 'Manager Two');

      // По вакансии на каждого менеджера + по бонусу
      const mkVacancy = async (mgr: string) => {
        const { rows } = await client.query(
          `INSERT INTO public.vacancies (title, manager_id, status, confidentiality, opened_at)
           VALUES ('RLS-тест', $1, 'active', 'open', CURRENT_DATE) RETURNING id`,
          [mgr],
        );
        return rows[0].id as string;
      };
      const v1 = await mkVacancy(m1);
      const v2 = await mkVacancy(m2);
      const mkBonus = async (vac: string, mgr: string) =>
        client.query(
          `INSERT INTO public.hr_bonuses (vacancy_id, manager_id, bonus_date, status, source, bonus_amount_kopecks)
           VALUES ($1, $2, CURRENT_DATE, 'pending', 'manual', 50000)`,
          [vac, mgr],
        );
      await mkBonus(v1, m1);
      await mkBonus(v2, m2);

      // ── контекст manager1 ──────────────────────────────────────────────────
      await actAs(client, m1);
      const { rows } = await client.query('SELECT manager_id FROM public.hr_bonuses');

      // позитив: видит свой бонус
      expect(rows.some((r) => r.manager_id === m1)).toBe(true);
      // негатив: НЕ видит чужой
      expect(rows.some((r) => r.manager_id === m2)).toBe(false);
      // и вообще все видимые строки — только свои
      expect(rows.every((r) => r.manager_id === m1)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
