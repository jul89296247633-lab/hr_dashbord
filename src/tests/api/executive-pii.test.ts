/**
 * @vitest-environment node
 *
 * EC-09 (security): роль executive НЕ должна получать имена/идентификаторы
 * менеджеров в ответах API. Покрывает фиксы FS-2 cross-model review:
 *   • GET /api/bonuses/summary
 *   • GET /api/vacancies/requests
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthUser } from '@/types';

vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return { ...actual, getAuthUser: vi.fn() };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import * as apiHelpers from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { makeSupabaseClient } from '@/tests/helpers/mock-supabase';

const mockGetAuthUser = apiHelpers.getAuthUser as ReturnType<typeof vi.fn>;
const mockCreateClient = createClient as ReturnType<typeof vi.fn>;

const MANAGER_NAME = 'Иванов Иван';

function asUser(role: AuthUser['role']): AuthUser {
  return { id: 'test-id', role, full_name: 'Test' };
}
function req(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(`http://localhost${url}`);
}

// ── GET /api/bonuses/summary ──────────────────────────────────────────────────
describe('GET /api/bonuses/summary — EC-09', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  // Клиент с .rpc(compute_manager_bonuses) → одна строка с именем менеджера.
  function rpcClient() {
    return {
      rpc: vi.fn().mockResolvedValue({
        data: [{ manager_id: 'm1', manager_name: MANAGER_NAME, closed_at: '2026-05-01', amount_kopecks: 5_000_000 }],
        error: null,
      }),
    };
  }

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/bonuses/summary/route');
    GET = mod.GET;
    mockCreateClient.mockResolvedValue(rpcClient());
  });

  it('executive: имя менеджера не уходит в ответ', async () => {
    mockGetAuthUser.mockResolvedValue(asUser('executive'));
    const res = await GET(req('/api/bonuses/summary?period=month'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(MANAGER_NAME);
    const body = JSON.parse(text);
    expect(body.data[0].full_name).toBe('—');
    expect(body.data[0].manager_id).toBeNull();
  });

  it('head: имя менеджера присутствует (контроль)', async () => {
    mockGetAuthUser.mockResolvedValue(asUser('head'));
    const res = await GET(req('/api/bonuses/summary?period=month'));
    const body = await res.json();
    expect(body.data[0].full_name).toBe(MANAGER_NAME);
    expect(body.data[0].manager_id).toBe('m1');
  });
});

// ── GET /api/vacancies/requests ───────────────────────────────────────────────
describe('GET /api/vacancies/requests — EC-09', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  const row = {
    id: 'r1', title: 'Продавец', location: 'Сочи', subdivision: 'Розница',
    confidentiality: 'open', status: 'draft', request_status: 'pending',
    request_reason: null, requested_by: 'u1', approved_by: null, approved_at: null,
    rejection_reason: null, opened_at: '2026-05-01', created_at: '2026-05-01',
    manager_id: 'm1', positions_count: 1,
    manager: { id: 'm1', full_name: MANAGER_NAME },
  };

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/vacancies/requests/route');
    GET = mod.GET;
    mockCreateClient.mockResolvedValue(makeSupabaseClient({ data: [row], count: 1, error: null }));
  });

  it('executive: manager/manager_id обнулены, имя не уходит', async () => {
    mockGetAuthUser.mockResolvedValue(asUser('executive'));
    const res = await GET(req('/api/vacancies/requests'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(MANAGER_NAME);
    const body = JSON.parse(text);
    expect(body.data[0].manager).toBeNull();
    expect(body.data[0].manager_id).toBeNull();
  });

  it('head: manager присутствует (контроль)', async () => {
    mockGetAuthUser.mockResolvedValue(asUser('head'));
    const res = await GET(req('/api/vacancies/requests'));
    const body = await res.json();
    expect(body.data[0].manager.full_name).toBe(MANAGER_NAME);
  });
});
