'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Role } from '@/types';
import { VacancyRequestForm } from '@/components/vacancy-requests/VacancyRequestForm';
import { VacancyRequestList } from '@/components/vacancy-requests/VacancyRequestList';

interface Manager {
  id: string;
  full_name: string;
}

interface Props {
  role: Role;
  userId: string;
  managers: Manager[];
}

/**
 * Клиентский оркестратор страницы /requests.
 * Держит состояние списка, активного таба и открытых модалок.
 */
export function VacancyRequestsClient({ role, userId, managers }: Props) {
  const [requests, setRequests] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [formOpen, setFormOpen] = useState(false);

  const canCreate = role !== 'executive';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filterStatus ? `?request_status=${filterStatus}` : '';
      const res = await fetch(`/api/vacancies/requests${qs}`);
      const json = await res.json() as { data?: unknown[]; error?: { message: string } };
      if (!res.ok) { setError(json.error?.message ?? 'Ошибка загрузки'); return; }
      setRequests(json.data ?? []);
    } catch {
      setError('Не удалось загрузить заявки');
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="grid gap-6">
      {/* Заголовок */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Заявки на вакансии</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Заявки создаются со статусом «На согласовании» и активируются после одобрения.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="size-4" />
            Новая заявка
          </Button>
        )}
      </div>

      {/* Список */}
      <VacancyRequestList
        loading={loading}
        error={error}
        requests={requests as Parameters<typeof VacancyRequestList>[0]['requests']}
        currentUserId={userId}
        currentRole={role}
        onTabChange={setFilterStatus}
        onRefresh={() => void load()}
      />

      {/* Форма создания */}
      {canCreate && (
        <VacancyRequestForm
          open={formOpen}
          onOpenChange={setFormOpen}
          managers={managers}
          currentUserId={userId}
          currentRole={role}
          onCreated={() => void load()}
        />
      )}
    </div>
  );
}
