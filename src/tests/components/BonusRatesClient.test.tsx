/**
 * BonusRatesClient — inline edit (Enter/Escape), валидация суммы,
 * history modal (пустое состояние), create modal, empty state.
 */
import React from 'react';
import { vi, describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/bonuses',
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';
import { BonusRatesClient } from '@/components/admin/BonusRatesClient';

const rate = {
  id: 'rate-1',
  position_name: 'Менеджер по продажам',
  amount_kopecks: 5000000,
  amount_display: '50 000 ₽',
  group_name: 'Розница',
  updated_at: '2026-05-01T00:00:00Z',
};

function mockFetchOne() {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [rate] }), { status: 200 }),
  );
}
function mockFetchEmpty() {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── Пустое состояние ─────────────────────────────────────────────────────────
describe('Пустое состояние', () => {
  it('показывает текст когда тарифов нет', async () => {
    mockFetchEmpty();
    render(<BonusRatesClient />);
    await waitFor(() => {
      expect(screen.getByText(/Тарифов нет/i)).toBeInTheDocument();
    });
  });
});

// ── Таблица тарифов ──────────────────────────────────────────────────────────
describe('Таблица тарифов', () => {
  it('отображает тариф из списка', async () => {
    mockFetchOne();
    render(<BonusRatesClient />);
    await waitFor(() => {
      expect(screen.getByText('Менеджер по продажам')).toBeInTheDocument();
      expect(screen.getByText('50 000 ₽')).toBeInTheDocument();
    });
  });

  it('отображает заголовок группы', async () => {
    mockFetchOne();
    render(<BonusRatesClient />);
    await waitFor(() => {
      expect(screen.getByText('Розница')).toBeInTheDocument();
    });
  });
});

// ── Inline edit ──────────────────────────────────────────────────────────────
describe('Inline edit', () => {
  it('клик на иконку Pencil открывает inputs', async () => {
    mockFetchOne();
    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
    expect((inputs[0] as HTMLInputElement).value).toBe('Менеджер по продажам');
  });

  it('Escape отменяет редактирование', async () => {
    mockFetchOne();
    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    const nameInput = screen.getAllByRole('textbox')[0];
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Другое название');
    await userEvent.keyboard('{Escape}');

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByText('Менеджер по продажам')).toBeInTheDocument();
  });

  it('невалидная сумма (0): toast.error, PATCH не вызывается', async () => {
    const fetchSpy = mockFetchOne();
    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    // Второй input — сумма (number)
    const amountInput = screen.getByRole('spinbutton');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '0');
    await userEvent.keyboard('{Enter}');

    expect(toast.error).toHaveBeenCalled();
    // fetch не должен вызываться с PATCH (только 1 вызов — начальная загрузка)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('пустое название: toast.error, PATCH не вызывается', async () => {
    const fetchSpy = mockFetchOne();
    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    const nameInput = screen.getAllByRole('textbox')[0];
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'А'); // 1 символ — меньше 2
    await userEvent.keyboard('{Enter}');

    expect(toast.error).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('успешный Enter → PATCH вызывается, данные перезагружаются', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [rate] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...rate, position_name: 'Новый тариф' }, message: 'Тариф обновлён' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        // перезагрузка после обновления
        new Response(JSON.stringify({ data: [{ ...rate, position_name: 'Новый тариф' }] }), { status: 200 }),
      );

    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    const nameInput = screen.getAllByRole('textbox')[0];
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Новый тариф');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      // Должен быть PATCH + перезагрузка
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(toast.success).toHaveBeenCalledWith('Тариф обновлён');
    });
  });

  it('провальный PATCH: toast.error, input остаётся открытым', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [rate] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        // Сервер возвращает конкретное сообщение ошибки
        new Response(JSON.stringify({ error: { code: 'DB_ERROR', message: 'Ошибка БД' } }), { status: 500 }),
      );

    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const editBtn = screen.getByRole('button', { name: /редактировать/i });
    await userEvent.click(editBtn);

    const nameInput = screen.getAllByRole('textbox')[0];
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Изменённый тариф');
    await userEvent.keyboard('{Enter}');

    // toast.error вызывается с текстом из ответа сервера
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Ошибка БД');
    });
    // editId не сброшен — input должен остаться открытым
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});

// ── History modal ────────────────────────────────────────────────────────────
describe('History modal', () => {
  it('пустая история → сообщение «Изменений не найдено»', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [rate] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const historyBtn = screen.getByRole('button', { name: /история/i });
    await userEvent.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByText(/Изменений не найдено/i)).toBeInTheDocument();
    });
  });

  it('история с записями отображает таймлайн', async () => {
    const historyEntry = {
      id: 'audit-1',
      action: 'UPDATE',
      old_values: { amount_kopecks: 4000000 },
      new_values: { amount_kopecks: 5000000 },
      created_at: '2026-05-15T10:00:00Z',
      user: { id: 'u1', full_name: 'Администратор', role: 'admin' },
    };

    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [rate] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [historyEntry] }), { status: 200 }),
      );

    render(<BonusRatesClient />);
    await screen.findByText('Менеджер по продажам');

    const historyBtn = screen.getByRole('button', { name: /история/i });
    await userEvent.click(historyBtn);

    await waitFor(() => {
      expect(screen.getByText(/Администратор/)).toBeInTheDocument();
      expect(screen.getByText(/UPDATE/)).toBeInTheDocument();
    });
  });
});
