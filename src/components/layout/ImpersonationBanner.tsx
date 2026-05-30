'use client';

import { useState } from 'react';
import { EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Постоянный баннер режима impersonation (SEC: FEATURE_SPEC_impersonation.md).
 * Показывается во всех (app)-страницах, пока активна сессия. Кнопка завершает её.
 */
export function ImpersonationBanner({ managerName }: { managerName: string }) {
  const [exiting, setExiting] = useState(false);

  async function exit() {
    setExiting(true);
    try {
      const res = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      if (!res.ok) {
        toast.error('Не удалось выйти из режима');
        setExiting(false);
        return;
      }
      // Полный reload: серверные компоненты пересоберутся уже без overlay.
      window.location.href = '/';
    } catch {
      toast.error('Не удалось выйти из режима');
      setExiting(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span className="flex items-center gap-2">
        <EyeOff className="size-4 shrink-0" />
        Режим просмотра: вы вошли как <strong>{managerName}</strong>. Изменения недоступны.
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-950/10 px-3 py-1 font-semibold hover:bg-amber-950/20 disabled:opacity-60"
      >
        {exiting && <Loader2 className="size-3 animate-spin" />}
        Выйти из режима
      </button>
    </div>
  );
}
