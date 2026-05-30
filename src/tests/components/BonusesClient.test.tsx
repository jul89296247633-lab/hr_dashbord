/**
 * BonusesClient — табы (pending/unmatched/paid),
 * mark-paid (admin only + pending only), match modal (пустой список).
 */
import React from 'react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/bonuses',
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';
import { BonusesClient } from '@/components/bonuses/BonusesClient';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const pendingBonus = {
  id: 'b1',
  vacancy_id: 'v1',
  manager_id: 'm1',
  matched_position_name: 'Менеджер',
  bonus_amount_kopecks: 5000000,
  bonus_amount_display: '50 000 ₽',
  bonus_date: '2026-05-01',
  status: 'pending',
  source: 'auto',
  vacancy: { id: 'v1', title: 'Вакансия А', closed_at: '2026-05-01' },
  manager: { id: 'm1', full_name: 'Иванов Иван', is_active: true },
};

const unmatchedBonus = {
  ...pendingBonus,
  id: 'b2',
  status: 'unmatched',
  matched_position_name: null,
  bonus_amount_kopecks: null,
  bonus_amount_display: null,
  vacancy: { id: 'v2', title: 'Вакансия Б', closed_at: '2026-05-02' },
};

function mockBonusesResponse(data: object[]) {
  return new Response(
    JSON.stringify({ data, total_amount_kopecks: 5000000, total_amount_display: '50 000 ₽', meta: { total: data.length } }),
    { status: 200 },
  );
}

function mockTeamResponse() {
  return new Response(
    JSON.stringify({ data: { managers: [{ id: 'm1', full_name: 'Иванов Иван' }] } }),
    { status: 200 },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── Таб «Начисленные» ────────────────────────────────────────────────────────
describe('Таб pending', () => {
  it('показывает бонус с суммой', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())  // dashboard/team
      .mockResolvedValueOnce(mockBonusesResponse([pendingBonus]));

    render(<BonusesClient role="head" />);
    // Ждём загрузки вакансии
    await screen.findByText('Вакансия А');
    // '50 000 ₽' появляется в нескольких местах (карточка + строка + итого)
    const amounts = screen.getAllByText('50 000 ₽');
    expect(amounts.length).toBeGreaterThan(0);
  });
});

// ── Кнопка «Выплачено» (mark-paid) ──────────────────────────────────────────
describe('Кнопка «Выплачено»', () => {
  it('admin + pending → кнопка отображается', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([pendingBonus]));

    render(<BonusesClient role="admin" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /выплачено/i })).toBeInTheDocument();
    });
  });

  it('head + pending → кнопки «Выплачено» нет', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([pendingBonus]));

    render(<BonusesClient role="head" />);
    await waitFor(() => {
      expect(screen.getByText('Вакансия А')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /выплачено/i })).not.toBeInTheDocument();
  });

  it('admin + paid таб → кнопки «Выплачено» нет (уже выплачен)', async () => {
    const paidBonus = { ...pendingBonus, status: 'paid' };
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([paidBonus])); // первая загрузка (pending — пусто)

    render(<BonusesClient role="admin" />);
    await waitFor(() => screen.getByText('Начисленные'));

    // Переходим на таб «Выплаченные»
    vi.spyOn(global, 'fetch').mockResolvedValue(mockBonusesResponse([paidBonus]));
    await userEvent.click(screen.getByRole('tab', { name: /выплаченные/i }));

    await waitFor(() => {
      expect(screen.getByText('Вакансия А')).toBeInTheDocument();
    });
    // На табе «paid» кнопки выплаты нет
    expect(screen.queryByRole('button', { name: /выплачено/i })).not.toBeInTheDocument();
  });

  it('admin: нажатие вызывает PATCH mark-paid + toast.success', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([pendingBonus]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...pendingBonus, status: 'paid' }, message: 'Выплачено' }), { status: 200 }),
      )
      .mockResolvedValue(mockBonusesResponse([])); // перезагрузка после PATCH

    render(<BonusesClient role="admin" />);
    await waitFor(() => screen.getByRole('button', { name: /выплачено/i }));

    await userEvent.click(screen.getByRole('button', { name: /выплачено/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Помечено как выплачено');
    });
    // Проверяем что PATCH был вызван с нужным URL
    const patchCall = fetchSpy.mock.calls.find(
      ([url, opts]) => typeof url === 'string' && url.includes('mark-paid') && (opts as RequestInit)?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
  });
});

// ── Таб «Без сопоставления» ──────────────────────────────────────────────────
describe('Таб unmatched', () => {
  it('показывает вакансию без тарифа', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([])); // pending (первая загрузка)

    render(<BonusesClient role="head" />);
    await waitFor(() => screen.getByText('Без сопоставления'));

    vi.spyOn(global, 'fetch').mockResolvedValue(mockBonusesResponse([unmatchedBonus]));
    await userEvent.click(screen.getByRole('tab', { name: /без сопоставления/i }));

    await waitFor(() => {
      expect(screen.getByText('Вакансия Б')).toBeInTheDocument();
    });
  });

  it('кнопка «Привязать тариф» видна для head', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([]));

    render(<BonusesClient role="head" />);
    await waitFor(() => screen.getByText('Без сопоставления'));

    vi.spyOn(global, 'fetch').mockResolvedValue(mockBonusesResponse([unmatchedBonus]));
    await userEvent.click(screen.getByRole('tab', { name: /без сопоставления/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /привязать тариф/i })).toBeInTheDocument();
    });
  });

  it('match modal: пустой список тарифов → кнопка «Привязать» disabled', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([]));

    render(<BonusesClient role="head" />);
    await waitFor(() => screen.getByText('Без сопоставления'));

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockBonusesResponse([unmatchedBonus])) // unmatched bonuses
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 })); // rates

    await userEvent.click(screen.getByRole('tab', { name: /без сопоставления/i }));
    await waitFor(() => screen.getByRole('button', { name: /привязать тариф/i }));

    await userEvent.click(screen.getByRole('button', { name: /привязать тариф/i }));

    await waitFor(() => {
      // Модал открылся — кнопка «Привязать» внутри disabled (нет selectedRate)
      const matchBtns = screen.getAllByRole('button', { name: /привязать/i });
      const confirmBtn = matchBtns.find((b) => b.closest('[role="dialog"]'));
      expect(confirmBtn).toBeTruthy();
      expect(confirmBtn).toBeDisabled();
    });
  });

  it('все бонусы сопоставлены → сообщение', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockTeamResponse())
      .mockResolvedValueOnce(mockBonusesResponse([]));

    render(<BonusesClient role="head" />);
    await waitFor(() => screen.getByText('Без сопоставления'));

    vi.spyOn(global, 'fetch').mockResolvedValue(mockBonusesResponse([]));
    await userEvent.click(screen.getByRole('tab', { name: /без сопоставления/i }));

    await waitFor(() => {
      expect(screen.getByText(/Все бонусы сопоставлены/i)).toBeInTheDocument();
    });
  });
});
