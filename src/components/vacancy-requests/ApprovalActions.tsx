'use client';

import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  requestId: string;
  requestedBy: string | null;
  currentUserId: string;
  currentRole: string;
  onDone: () => void;
}

/**
 * Кнопки согласования/отклонения для head | admin | executive.
 * Нельзя согласовать собственную заявку.
 */
export function ApprovalActions({ requestId, requestedBy, currentUserId, currentRole, onDone }: Props) {
  const canApprove = ['head', 'admin', 'executive'].includes(currentRole);
  const isOwn = requestedBy === currentUserId;

  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  if (!canApprove) return null;

  async function handleApprove() {
    if (isOwn) { toast.error('Нельзя согласовать собственную заявку'); return; }
    setApproving(true);
    try {
      const res = await fetch(`/api/vacancies/requests/${requestId}/approve`, { method: 'PATCH' });
      const json = await res.json() as { error?: { message: string } };
      if (!res.ok) { toast.error(json.error?.message ?? 'Ошибка согласования'); return; }
      toast.success('Заявка согласована');
      onDone();
    } catch { toast.error('Не удалось согласовать'); }
    finally { setApproving(false); }
  }

  async function handleReject() {
    if (!rejectionReason.trim()) { toast.error('Укажите причину отклонения'); return; }
    setRejecting(true);
    try {
      const res = await fetch(`/api/vacancies/requests/${requestId}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejection_reason: rejectionReason.trim() }),
      });
      const json = await res.json() as { error?: { message: string } };
      if (!res.ok) { toast.error(json.error?.message ?? 'Ошибка отклонения'); return; }
      toast.success('Заявка отклонена');
      setRejectOpen(false);
      onDone();
    } catch { toast.error('Не удалось отклонить'); }
    finally { setRejecting(false); }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="text-green-700 hover:text-green-700"
          onClick={handleApprove}
          disabled={approving || isOwn}
          title={isOwn ? 'Нельзя согласовать собственную заявку' : undefined}
        >
          {approving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Согласовать
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => { setRejectionReason(''); setRejectOpen(true); }}
          disabled={isOwn}
        >
          <X className="size-3.5" />
          Отклонить
        </Button>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отклонить заявку</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Причина отклонения *</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              maxLength={500}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Нет бюджета на Q2…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejecting}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting && <Loader2 className="size-4 animate-spin" />}
              Отклонить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
