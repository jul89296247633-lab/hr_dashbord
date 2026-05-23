'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Тост-уведомления (sonner). Светлая тема проекта (CLAUDE.md). */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      richColors
      position="top-right"
      {...props}
    />
  );
}

export { Toaster };
