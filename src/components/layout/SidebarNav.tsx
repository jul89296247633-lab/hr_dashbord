'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { activeHref, navItemsForRole } from '@/lib/nav';
import type { Role } from '@/types';

/**
 * Список ссылок навигации с подсветкой активного пункта.
 *
 * Принимает `role`, а не уже посчитанные `items` — потому что NavItem содержит
 * `icon: LucideIcon` (React-компонент / функция), и передача массива из Server
 * Component уронила бы RSC-границу с «Functions cannot be passed directly to
 * Client Components». Вычисляем items внутри клиента.
 */
export function SidebarNav({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = useMemo(() => navItemsForRole(role), [role]);
  const active = activeHref(items, pathname);

  return (
    <nav className="grid gap-1 px-3">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
