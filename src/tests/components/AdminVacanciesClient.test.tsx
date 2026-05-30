/**
 * AdminVacanciesClient — EC-8, VacancyEditableCell (inline edit + откат),
 * CSV export, пустое состояние.
 */
import React from 'react';
import { vi, describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/vacancies/admin',
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from 'sonner';
import { AdminVacanciesClient } from '@/components/vacancies/AdminVacanciesClient';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const managers = [
  { id: 'm1', full_name: 'Иванов Иван' },
  { id: 'm2', full_name: 'Петрова Мария' },
];

const vacancy = {
  id: 'v1',
  hh_vacancy_id: '12345',
  internal_ref: null,
  title: 'Старший продавец',
  subdivision: 'Розница',
  location: 'Сочи',
  manager_id: 'm1',
  status: 'active' as const,
  confidentiality: 'open' as const,
  opened_at: '2026-05-01',
  closed_at: null,
  days_to_close: null,
  priority: null,
  manager: { id: 'm1', full_name: 'Иванов Иван' },
};

const vacancyExec = { ...vacancy, manager: null, manager_id: null };

function listResponse(data: object[]) {
  return new Response(
    JSON.stringify({ data, meta: { total: data.length, page: 1, per_page: 50 } }),
    { status: 200 },
  );
}

/** Находит первую строку данных таблицы (не header). */
async function getDataRow() {
  const rows = await screen.findAllByRole('row');
  // rows[0] — header, rows[1] — первая строка данных
  return rows[1];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── EC-8: Колонка «Менеджер» ─────────────────────────────────────────────────
describe('EC-8: колонка «Менеджер» по роли', () => {
  it('executive: имя менеджера не отображается в строке', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancyExec]));
    render(<AdminVacanciesClient role="executive" managers={managers} />);

    const row = await getDataRow();
    // Имя менеджера не должно быть ни в одной ячейке строки
    expect(within(row).queryByText('Иванов Иван')).not.toBeInTheDocument();
    // Вакансия загружена
    expect(within(row).getByText('Старший продавец')).toBeInTheDocument();
  });

  it('head: имя менеджера отображается в строке', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    render(<AdminVacanciesClient role="head" managers={managers} />);

    const row = await getDataRow();
    expect(within(row).getByText('Иванов Иван')).toBeInTheDocument();
  });

  it('admin: имя менеджера отображается в строке', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const row = await getDataRow();
    expect(within(row).getByText('Иванов Иван')).toBeInTheDocument();
  });

  it('executive: кнопка «Добавить» скрыта (нет прав редактирования)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([]));
    render(<AdminVacanciesClient role="executive" managers={managers} />);

    await screen.findByText('Вакансий нет.');
    expect(screen.queryByRole('button', { name: /добавить/i })).not.toBeInTheDocument();
  });
});

// ── VacancyEditableCell: inline edit ─────────────────────────────────────────
describe('VacancyEditableCell — inline edit', () => {
  /** Получает редактируемую ячейку title (span в первой строке). */
  async function getTitleCell() {
    const row = await getDataRow();
    // VacancyEditableCell рендерит span с title="Двойной клик для редактирования"
    const editableSpans = within(row).getAllByTitle('Двойной клик для редактирования');
    // Первый editable span — это title (Старший продавец)
    return editableSpans[0];
  }

  /** Находит input внутри строки таблицы (исключает search/city inputs в filters). */
  async function getRowInput() {
    const row = await getDataRow();
    // VacancyEditableCell помещает Input внутри ячейки таблицы
    return within(row).getByRole('textbox');
  }

  it('двойной клик показывает input с текущим значением', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    expect(cell.textContent).toBe('Старший продавец');
    await userEvent.dblClick(cell);

    const input = await getRowInput();
    expect((input as HTMLInputElement).value).toBe('Старший продавец');
  });

  it('Escape закрывает input, значение возвращается к исходному', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    await userEvent.dblClick(cell);

    const input = await getRowInput();
    await userEvent.clear(input);
    await userEvent.type(input, 'Другое название');
    await userEvent.keyboard('{Escape}');

    // Input закрыт
    const row = await getDataRow();
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    // Span восстановлен с исходным значением
    expect(within(row).getByText('Старший продавец')).toBeInTheDocument();
  });

  it('успешный Enter → PATCH вызван, input закрыт', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(listResponse([vacancy]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...vacancy, title: 'Ведущий продавец' } }), { status: 200 }),
      );

    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    await userEvent.dblClick(cell);

    const input = await getRowInput();
    await userEvent.clear(input);
    await userEvent.type(input, 'Ведущий продавец');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const row = await getDataRow();
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('провальный PATCH: ячейка откатывается, toast.error показан', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(listResponse([vacancy]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'DB_ERROR', message: 'Ошибка' } }), { status: 500 }),
      );

    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    await userEvent.dblClick(cell);

    const input = await getRowInput();
    await userEvent.clear(input);
    await userEvent.type(input, 'Неверное');
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Input закрыт, исходный текст восстановлен
    const row = await getDataRow();
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(row).getByText('Старший продавец')).toBeInTheDocument();
  });

  it('одинаковое значение: PATCH не вызывается', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    await userEvent.dblClick(cell);
    // Enter без изменения значения
    await userEvent.keyboard('{Enter}');

    await waitFor(async () => {
      const row = await getDataRow();
      expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    });
    // Только 1 fetch-вызов (начальная загрузка)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── CSV Export ───────────────────────────────────────────────────────────────
describe('CSV export', () => {
  it('export не бросает исключений и скачивает файл', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = vi.fn();

    // Перехватываем click на anchor
    const origAppendChild = document.body.appendChild.bind(document.body);
    let anchorClicked = false;
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      const el = node as HTMLAnchorElement;
      if (el.tagName === 'A') {
        anchorClicked = true;
        return node;
      }
      return origAppendChild(node);
    });

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await getDataRow(); // Дождаться загрузки

    await userEvent.click(screen.getByRole('button', { name: /csv/i }));

    expect(createObjectURL).toHaveBeenCalled();
  });

  it('executive: CSV не содержит имена менеджеров', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancyExec]));

    // Перехватываем Blob через URL.createObjectURL, не мокируя конструктор
    const capturedBlobs: Blob[] = [];
    global.URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      capturedBlobs.push(blob);
      return 'blob:test';
    });
    global.URL.revokeObjectURL = vi.fn();

    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = vi.fn();

    render(<AdminVacanciesClient role="executive" managers={managers} />);
    await getDataRow();

    await userEvent.click(screen.getByRole('button', { name: /csv/i }));

    // Читаем содержимое Blob асинхронно
    expect(capturedBlobs.length).toBeGreaterThan(0);
    const csvText = await capturedBlobs[0].text();
    expect(csvText).not.toContain('Иванов Иван');

    HTMLAnchorElement.prototype.click = origClick;
  });
});

// ── Пустое состояние ─────────────────────────────────────────────────────────
describe('Пустое состояние', () => {
  it('показывает «Вакансий нет.» когда список пуст', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([]));
    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await screen.findByText('Вакансий нет.');
    expect(screen.getByText('Вакансий нет.')).toBeInTheDocument();
  });
});
