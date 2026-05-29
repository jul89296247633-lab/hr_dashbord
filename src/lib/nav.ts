import {
  Home,
  LayoutDashboard,
  Briefcase,
  Wallet,
  TrendingUp,
  Building2,
  Target,
  ClipboardList,
  RefreshCw,
  Sparkles,
  Users,
  Plug,
  ScrollText,
  Rocket,
  FileCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Пункты навигации по роли (SPEC Блок 0 URL-маршруты). */
export function navItemsForRole(role: Role): NavItem[] {
  if (role === 'manager') {
    return [
      { label: 'Кабинет', href: '/cabinet', icon: Home },
      { label: 'Мой дашборд', href: '/dashboard/manager', icon: LayoutDashboard },
      { label: 'Мои вакансии', href: '/vacancies', icon: Briefcase },
      { label: 'Заявки', href: '/requests', icon: FileCheck },
      { label: 'Бонусы', href: '/bonuses', icon: Wallet },
    ];
  }

  if (role === 'executive') {
    return [
      { label: 'Дашборд', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Подразделения', href: '/dashboard/divisions', icon: Building2 },
      { label: 'Штатное расписание', href: '/staffing/plan', icon: ClipboardList },
      { label: 'Заявки', href: '/requests', icon: FileCheck },
    ];
  }

  // head и admin: общий набор.
  const items: NavItem[] = [
    { label: 'Дашборд', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Эффективность', href: '/dashboard/efficiency', icon: TrendingUp },
    { label: 'Подразделения', href: '/dashboard/divisions', icon: Building2 },
    { label: 'Вакансии', href: '/vacancies', icon: Briefcase },
    { label: 'Заявки', href: '/requests', icon: FileCheck },
    { label: 'План', href: '/plan', icon: Target },
    { label: 'Штатное расписание', href: '/staffing/plan', icon: ClipboardList },
    { label: 'Синхронизация', href: '/sync', icon: RefreshCw },
    { label: 'AI', href: '/ai', icon: Sparkles },
    { label: 'Бонусы', href: '/bonuses', icon: Wallet },
  ];

  if (role === 'admin') {
    items.push(
      { label: 'Пользователи', href: '/admin/users', icon: Users },
      { label: 'Интеграции', href: '/admin/integrations', icon: Plug },
      { label: 'Логи', href: '/admin/logs', icon: ScrollText },
      { label: 'Запуск компании', href: '/onboarding', icon: Rocket },
    );
  }

  return items;
}

const ROLE_LABELS: Record<Role, string> = {
  manager: 'Менеджер',
  head: 'Руководитель HR',
  executive: 'Топ-менеджмент',
  admin: 'Администратор',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

/** Активный пункт = самый длинный href, являющийся префиксом текущего пути. */
export function activeHref(items: NavItem[], pathname: string): string | null {
  const matches = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}
