import { describe, it, expect } from 'vitest';
import { navItemsForRole } from '@/lib/nav';
import type { Role } from '@/types';

const hrefs = (role: Role) => navItemsForRole(role).map((i) => i.href);

describe('navItemsForRole', () => {
  // ── Роль manager ────────────────────────────────────────────────────────────
  describe('manager', () => {
    it('не содержит /admin/bonuses', () => {
      expect(hrefs('manager')).not.toContain('/admin/bonuses');
    });
    it('не содержит /vacancies/admin', () => {
      expect(hrefs('manager')).not.toContain('/vacancies/admin');
    });
    it('содержит /bonuses и /vacancies', () => {
      expect(hrefs('manager')).toContain('/bonuses');
      expect(hrefs('manager')).toContain('/vacancies');
    });
  });

  // ── Роль executive ──────────────────────────────────────────────────────────
  describe('executive', () => {
    it('содержит /vacancies/admin', () => {
      expect(hrefs('executive')).toContain('/vacancies/admin');
    });
    it('не содержит /admin/bonuses', () => {
      expect(hrefs('executive')).not.toContain('/admin/bonuses');
    });
    it('не содержит /vacancies (менеджерский)', () => {
      expect(hrefs('executive')).not.toContain('/vacancies');
    });
  });

  // ── Роль head ───────────────────────────────────────────────────────────────
  describe('head', () => {
    it('содержит /vacancies/admin', () => {
      expect(hrefs('head')).toContain('/vacancies/admin');
    });
    it('не содержит /admin/bonuses', () => {
      expect(hrefs('head')).not.toContain('/admin/bonuses');
    });
    it('/vacancies/admin идёт сразу после /vacancies', () => {
      const list = hrefs('head');
      const vacIdx = list.indexOf('/vacancies');
      const adminIdx = list.indexOf('/vacancies/admin');
      expect(vacIdx).toBeGreaterThanOrEqual(0);
      expect(adminIdx).toBe(vacIdx + 1);
    });
  });

  // ── Роль admin ──────────────────────────────────────────────────────────────
  describe('admin', () => {
    it('содержит /vacancies/admin', () => {
      expect(hrefs('admin')).toContain('/vacancies/admin');
    });
    it('содержит /admin/bonuses', () => {
      expect(hrefs('admin')).toContain('/admin/bonuses');
    });
    it('/vacancies/admin идёт сразу после /vacancies', () => {
      const list = hrefs('admin');
      const vacIdx = list.indexOf('/vacancies');
      const adminIdx = list.indexOf('/vacancies/admin');
      expect(adminIdx).toBe(vacIdx + 1);
    });
    it('/admin/bonuses идёт сразу после /bonuses', () => {
      const list = hrefs('admin');
      const bonusIdx = list.indexOf('/bonuses');
      const ratesIdx = list.indexOf('/admin/bonuses');
      expect(bonusIdx).toBeGreaterThanOrEqual(0);
      expect(ratesIdx).toBe(bonusIdx + 1);
    });
    it('содержит все admin-разделы', () => {
      const list = hrefs('admin');
      expect(list).toContain('/admin/users');
      expect(list).toContain('/admin/integrations');
      expect(list).toContain('/admin/logs');
    });
  });

  // ── Уникальность href ───────────────────────────────────────────────────────
  it.each(['manager', 'executive', 'head', 'admin'] as Role[])(
    'нет дублирующихся href для роли %s',
    (role) => {
      const list = hrefs(role);
      expect(new Set(list).size).toBe(list.length);
    },
  );

  // ── Каждый NavItem имеет label и icon ───────────────────────────────────────
  it.each(['manager', 'executive', 'head', 'admin'] as Role[])(
    'все пункты имеют label и icon для роли %s',
    (role) => {
      for (const item of navItemsForRole(role)) {
        expect(item.label).toBeTruthy();
        // lucide-react иконки могут быть function или React.forwardRef object
        expect(item.icon).toBeTruthy();
      }
    },
  );
});
