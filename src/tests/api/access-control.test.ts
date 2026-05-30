/**
 * @vitest-environment node
 *
 * API Route Access Control — матрица ролей.
 *
 * Стратегия: мокируем только getAuthUser (возвращает нужную роль),
 * requireRole и handleApiError оставляем реальными — тест проверяет
 * фактическую цепочку авторизации в каждом роуте.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthUser } from '@/types';

// ── Моки модулей ────────────────────────────────────────────────────────────
vi.mock('@/lib/api-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-helpers')>();
  return { ...actual, getAuthUser: vi.fn() };
});
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

// Импортируем после мока
import * as apiHelpers from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { makeSupabaseClient, makeSupabaseMulti } from '@/tests/helpers/mock-supabase';

const mockGetAuthUser = apiHelpers.getAuthUser as ReturnType<typeof vi.fn>;
const mockCreateAdmin = createAdminClient as ReturnType<typeof vi.fn>;
const mockCreateClient = createClient as ReturnType<typeof vi.fn>;

function asUser(role: AuthUser['role']): AuthUser {
  return { id: 'test-id', role, full_name: 'Test' };
}

function req(url: string, opts?: RequestInit) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(`http://localhost${url}`, opts as any);
}

// Суpabase-клиент, возвращающий пустой успешный ответ для любого запроса
function okClient() {
  return makeSupabaseClient({ data: [], error: null });
}

// ── /api/admin/bonus-rates ──────────────────────────────────────────────────
describe('GET /api/admin/bonus-rates', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    // Переимпортируем, чтобы моки пересоздались
    const mod = await import('@/app/api/admin/bonus-rates/route');
    GET = mod.GET;
    mockCreateClient.mockResolvedValue(okClient());
    mockCreateAdmin.mockReturnValue(okClient());
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 200],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await GET(req('/api/admin/bonus-rates'));
      expect(res.status).toBe(expected);
    },
  );
});

describe('POST /api/admin/bonus-rates', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/admin/bonus-rates/route');
    POST = mod.POST;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({
      data: { id: 'rate-1', position_name: 'Test', amount_kopecks: 5000000, group_name: null, created_at: '', updated_at: '' },
      error: null,
    }));
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 201],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const body = JSON.stringify({ position_name: 'Менеджер', amount_rubles: 50000 });
      const res = await POST(req('/api/admin/bonus-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }));
      expect(res.status).toBe(expected);
    },
  );
});

// ── /api/admin/bonus-rates/[id] ─────────────────────────────────────────────
describe('PATCH /api/admin/bonus-rates/[id]', () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/admin/bonus-rates/[id]/route');
    PATCH = mod.PATCH;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({
      data: { id: VALID_UUID, position_name: 'Test', amount_kopecks: 5000000, group_name: null, updated_at: '' },
      error: null,
    }));
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const body = JSON.stringify({ position_name: 'Новый тариф' });
      const res = await PATCH(
        req(`/api/admin/bonus-rates/${VALID_UUID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );
});

describe('DELETE /api/admin/bonus-rates/[id]', () => {
  let DELETE_: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/admin/bonus-rates/[id]/route');
    DELETE_ = mod.DELETE;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({ data: null, error: null }));
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await DELETE_(
        req(`/api/admin/bonus-rates/${VALID_UUID}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );
});

// ── /api/admin/bonus-rates/[id]/history ────────────────────────────────────
describe('GET /api/admin/bonus-rates/[id]/history', () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/admin/bonus-rates/[id]/history/route');
    GET = mod.GET;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({ data: [], error: null }));
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await GET(
        req(`/api/admin/bonus-rates/${VALID_UUID}/history`),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );
});

// ── /api/vacancies/admin ────────────────────────────────────────────────────
describe('GET /api/vacancies/admin', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/vacancies/admin/route');
    GET = mod.GET;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({ data: [], count: 0, error: null }));
  });

  it.each([
    ['manager', 403],
    ['executive', 200],
    ['head', 200],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await GET(req('/api/vacancies/admin'));
      expect(res.status).toBe(expected);
    },
  );
});

// ── /api/bonuses/[id]/match ─────────────────────────────────────────────────
describe('PATCH /api/bonuses/[id]/match', () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/bonuses/[id]/match/route');
    PATCH = mod.PATCH;
    // match требует status='unmatched' при первом SELECT и возвращает обновлённый бонус при UPDATE
    const qb = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: VALID_UUID, status: 'unmatched' }, error: null }),
      single: vi.fn().mockResolvedValue({ data: { id: VALID_UUID, status: 'pending', bonus_amount_kopecks: 5000000 }, error: null }),
    };
    (qb.select as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.eq as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.update as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    mockCreateAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(qb) });
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 200],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const body = JSON.stringify({ matched_position_name: 'Менеджер', bonus_amount_kopecks: 5000000 });
      const res = await PATCH(
        req(`/api/bonuses/${VALID_UUID}/match`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );
});

// ── /api/bonuses/[id]/mark-paid ─────────────────────────────────────────────
describe('PATCH /api/bonuses/[id]/mark-paid', () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  function setupMockPending() {
    // from('hr_bonuses').select().eq().maybeSingle() → pending bonus
    // from('hr_bonuses').update().eq().select().single() → updated bonus
    const qb = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: VALID_UUID, status: 'pending' }, error: null }),
      single: vi.fn().mockResolvedValue({ data: { id: VALID_UUID, status: 'paid' }, error: null }),
    };
    (qb.select as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.eq as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.update as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    mockCreateAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(qb) });
  }

  function setupMockNonPending(status: string) {
    const qb = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: VALID_UUID, status }, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    (qb.select as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.eq as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    (qb.update as ReturnType<typeof vi.fn>).mockReturnValue(qb);
    mockCreateAdmin.mockReturnValue({ from: vi.fn().mockReturnValue(qb) });
  }

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/bonuses/[id]/mark-paid/route');
    PATCH = mod.PATCH;
  });

  // Матрица ролей (бонус pending)
  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      setupMockPending();
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await PATCH(
        req(`/api/bonuses/${VALID_UUID}/mark-paid`, { method: 'PATCH' }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );

  // Бизнес-логика: только pending-бонус можно пометить выплаченным
  it('admin + status=pending → 200', async () => {
    setupMockPending();
    mockGetAuthUser.mockResolvedValue(asUser('admin'));
    const res = await PATCH(
      req(`/api/bonuses/${VALID_UUID}/mark-paid`, { method: 'PATCH' }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
  });

  it('admin + status=paid → 409 INVALID_STATE', async () => {
    setupMockNonPending('paid');
    mockGetAuthUser.mockResolvedValue(asUser('admin'));
    const res = await PATCH(
      req(`/api/bonuses/${VALID_UUID}/mark-paid`, { method: 'PATCH' }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_STATE');
  });

  it('admin + status=unmatched → 409 INVALID_STATE', async () => {
    setupMockNonPending('unmatched');
    mockGetAuthUser.mockResolvedValue(asUser('admin'));
    const res = await PATCH(
      req(`/api/bonuses/${VALID_UUID}/mark-paid`, { method: 'PATCH' }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(409);
  });
});

// ── /api/bonuses/[id] DELETE ────────────────────────────────────────────────
describe('DELETE /api/bonuses/[id]', () => {
  let DELETE_: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const VALID_UUID = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/app/api/bonuses/[id]/route');
    DELETE_ = mod.DELETE;
    mockCreateAdmin.mockReturnValue(makeSupabaseClient({ data: null, error: null }));
  });

  it.each([
    ['manager', 403],
    ['executive', 403],
    ['head', 403],
    ['admin', 200],
  ] as [AuthUser['role'], number][])(
    'роль %s → %d',
    async (role, expected) => {
      mockGetAuthUser.mockResolvedValue(asUser(role));
      const res = await DELETE_(
        req(`/api/bonuses/${VALID_UUID}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status).toBe(expected);
    },
  );
});

// ── Невалидный UUID возвращает 404, а не 403/500 ─────────────────────────────
describe('Невалидный UUID → 404', () => {
  it('DELETE /api/admin/bonus-rates с мусорным id', async () => {
    vi.resetModules();
    const mod = await import('@/app/api/admin/bonus-rates/[id]/route');
    mockGetAuthUser.mockResolvedValue(asUser('admin'));
    mockCreateAdmin.mockReturnValue(makeSupabaseClient());
    const res = await mod.DELETE(
      req('/api/admin/bonus-rates/not-a-uuid', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
  });
});
