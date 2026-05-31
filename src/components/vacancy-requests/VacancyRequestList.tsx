'use client';

import { useState } from 'react';
import { AlertCircle, Lock, Unlock } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApprovalActions } from '@/components/vacancy-requests/ApprovalActions';
import { ActivateModal } from '@/components/vacancy-requests/ActivateModal';
import type { VacancyRequestStatus } from '@/types';

interface RequestRow {
  id: string;
  title: string;
  location: string | null;
  subdivision: string | null;
  confidentiality: 'open' | 'confidential';
  request_status: VacancyRequestStatus | null;
  request_reason: string | null;
  rejection_reason: string | null;
  requested_by: string | null;
  opened_at: string;
  created_at: string;
  positions_count: number | null;
  manager: { id: string; full_name: string } | null;
}

interface Props {
  loading: boolean;
  error: string | null;
  requests: RequestRow[];
  currentUserId: string;
  currentRole: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'На согласовании',
  approved: 'Согласована',
  rejected: 'Отклонена',
};

function StatusBadge({ status }: { status: VacancyRequestStatus | null }) {
  if (!status) return null;
  const variant =
    status === 'approved' ? 'default' :
    status === 'rejected' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="shrink-0">{STATUS_LABELS[status]}</Badge>;
}

export function VacancyRequestList({
  loading,
  error,
  requests,
  currentUserId,
  currentRole,
  onTabChange,
  onRefresh,
}: Props) {
  const [activeTab, setActiveTab] = useState('pending');
  const [activateTarget, setActivateTarget] = useState<RequestRow | null>(null);

  function handleTab(tab: string) {
    setActiveTab(tab);
    onTabChange(tab === 'all' ? '' : tab);
  }

  const showAllTab = currentRole !== 'manager';

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Ошибка загрузки</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      <Tabs value={activeTab} onValueChange={handleTab}>
        <TabsList>
          <TabsTrigger value="pending">На согласовании</TabsTrigger>
          <TabsTrigger value="approved">Согласованы</TabsTrigger>
          <TabsTrigger value="rejected">Отклонены</TabsTrigger>
          {showAllTab && <TabsTrigger value="all">Все</TabsTrigger>}
        </TabsList>
      </Tabs>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {activeTab === 'pending' && 'Нет заявок на согласовании'}
              {activeTab === 'approved' && 'Нет согласованных заявок'}
              {activeTab === 'rejected' && 'Нет отклонённых заявок'}
              {activeTab === 'all' && 'Заявок пока нет'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {requests.map((req) => (
            <Card key={req.id}>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Основная информация */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{req.title}</span>
                      <StatusBadge status={req.request_status} />
                      <Badge variant="outline" className="gap-1 text-xs">
                        {req.confidentiality === 'confidential'
                          ? <><Lock className="size-3" />Конфиденциальная</>
                          : <><Unlock className="size-3" />Открытая</>
                        }
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {[req.location, req.subdivision].filter(Boolean).join(' · ')}
                      {req.manager && ` · Исполнитель: ${req.manager.full_name}`}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Открытие: {req.opened_at}
                      {req.requested_by === currentUserId && ' · Ваша заявка'}
                    </p>
                    {req.request_reason && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        Причина: {req.request_reason}
                      </p>
                    )}
                    {req.rejection_reason && (
                      <p className="text-destructive mt-1 text-xs">
                        Отклонена: {req.rejection_reason}
                      </p>
                    )}
                  </div>

                  {/* Действия */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {/* Активация для автора или head/admin — только approved */}
                    {req.request_status === 'approved' &&
                      (req.requested_by === currentUserId ||
                        currentRole === 'head' ||
                        currentRole === 'admin') && (
                        <Button
                          size="sm"
                          onClick={() => setActivateTarget(req)}
                        >
                          Активировать
                        </Button>
                      )}

                    {/* Согласование/отклонение для руководителей — только pending */}
                    {req.request_status === 'pending' && (
                      <ApprovalActions
                        requestId={req.id}
                        requestedBy={req.requested_by}
                        currentUserId={currentUserId}
                        currentRole={currentRole}
                        onDone={onRefresh}
                      />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activateTarget && (
        <ActivateModal
          open={!!activateTarget}
          onOpenChange={(o) => { if (!o) setActivateTarget(null); }}
          requestId={activateTarget.id}
          confidentiality={activateTarget.confidentiality}
          title={activateTarget.title}
          positionsCount={activateTarget.positions_count ?? 1}
          onActivated={() => { setActivateTarget(null); onRefresh(); }}
        />
      )}
    </div>
  );
}
