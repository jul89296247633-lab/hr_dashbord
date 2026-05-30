import { describe, it, expect } from 'vitest';
import { requireRole, ApiError } from '@/lib/api-helpers';
import type { AuthUser } from '@/types';

function user(role: AuthUser['role']): AuthUser {
  return { id: 'test-uuid', role, full_name: 'Test User' };
}

describe('requireRole', () => {
  // ── Проходит при правильной роли ────────────────────────────────────────────
  it('не бросает, если роль в списке (одиночный)', () => {
    expect(() => requireRole(user('admin'), ['admin'])).not.toThrow();
  });

  it('не бросает, если роль в списке (множественный)', () => {
    expect(() => requireRole(user('head'), ['head', 'admin'])).not.toThrow();
    expect(() => requireRole(user('admin'), ['head', 'admin'])).not.toThrow();
  });

  it('не бросает для executive, если в списке', () => {
    expect(() => requireRole(user('executive'), ['head', 'admin', 'executive'])).not.toThrow();
  });

  // ── Бросает ApiError(403) при неверной роли ─────────────────────────────────
  it('бросает ApiError при несовпадении роли', () => {
    expect(() => requireRole(user('manager'), ['admin'])).toThrow(ApiError);
  });

  it('код ошибки = FORBIDDEN, статус = 403', () => {
    try {
      requireRole(user('manager'), ['admin']);
      expect.fail('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('executive не проходит head/admin список', () => {
    expect(() => requireRole(user('executive'), ['head', 'admin'])).toThrow(ApiError);
  });

  it('head не проходит admin-only список', () => {
    expect(() => requireRole(user('head'), ['admin'])).toThrow(ApiError);
  });

  it('manager не проходит ни один список кроме manager', () => {
    expect(() => requireRole(user('manager'), ['head', 'admin', 'executive'])).toThrow(ApiError);
  });

  // ── Матрица: все роли против ['admin'] ──────────────────────────────────────
  it.each([
    ['manager', false],
    ['executive', false],
    ['head', false],
    ['admin', true],
  ] as [AuthUser['role'], boolean][])(
    "роль '%s' против ['admin']: проходит=%s",
    (role, shouldPass) => {
      if (shouldPass) {
        expect(() => requireRole(user(role), ['admin'])).not.toThrow();
      } else {
        expect(() => requireRole(user(role), ['admin'])).toThrow(ApiError);
      }
    },
  );
});
