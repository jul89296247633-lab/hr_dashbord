'use client';

import { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/**
 * Кнопка «Войти как менеджер» (SEC: FEATURE_SPEC_impersonation.md).
 * Доступна admin/head; рендерить только для строк с role='manager'.
 * При успехе уводит на /cabinet (домашняя менеджера) — дальше весь UI как менеджер.
 */
export function ImpersonateButton({
  managerId,
  managerName,
}: {
  managerId: string;
  managerName: string;
}) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_id: managerId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? 'Не удалось войти как менеджер');
        setLoading(false);
        return;
      }
      window.location.href = '/cabinet';
    } catch {
      toast.error('Не удалось войти как менеджер');
      setLoading(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={go}
      disabled={loading}
      aria-label={`Войти как ${managerName}`}
      title={`Войти как ${managerName}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
    </Button>
  );
}
