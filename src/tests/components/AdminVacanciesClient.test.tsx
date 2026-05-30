/**
 * AdminVacanciesClient — EC-8, VacancyEditableCell (inline edit + откат + blur),
 * VacancyStatusCell (closed требует Calendar), CSV export, пустое состояние.
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

/** Получает редактируемую ячейку title (первый editable span в строке). */
async function getTitleCell() {
  const row = await getDataRow();
  const editableSpans = within(row).getAllByTitle('Двойной клик для редактирования');
  return editableSpans[0];
}

/** Находит textbox внутри строки таблицы (исключает search/city inputs в filters). */
async function getRowInput() {
  const row = await getDataRow();
  return within(row).getByRole('textbox');
}

// ── VacancyEditableCell: inline edit ─────────────────────────────────────────
describe('VacancyEditableCell — inline edit', () => {

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

// ── VacancyEditableCell: blur ─────────────────────────────────────────────────
describe('VacancyEditableCell — blur', () => {
  it('blur вызывает save (fetch PATCH)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(listResponse([vacancy]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...vacancy, title: 'Блюр тест' } }), { status: 200 }),
      );

    render(<AdminVacanciesClient role="admin" managers={managers} />);

    const cell = await getTitleCell();
    await userEvent.dblClick(cell);

    const row = await getDataRow();
    const input = within(row).getByRole('textbox');

    // Меняем значение и теряем фокус (blur)
    await userEvent.clear(input);
    await userEvent.type(input, 'Блюр тест');
    await userEvent.tab(); // tab уходит с поля → вызывает blur

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByDisplayValue('Блюр тест')).not.toBeInTheDocument(); // input закрыт
  });

  it('blur без изменений: PATCH не вызывается', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    const cell = await getTitleCell();
    await userEvent.dblClick(cell);

    // Blur без изменения значения (Tab сразу)
    await userEvent.tab();

    await waitFor(() => {
      const row = screen.getAllByRole('row')[1];
      expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
    });
    // fetch должен вызваться только 1 раз (загрузка)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ── VacancyStatusCell: closed требует Calendar ────────────────────────────────
describe('VacancyStatusCell — статус closed', () => {
  it('клик «Закрыта» показывает Calendar, не вызывает PATCH сразу', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await getDataRow();

    // Открываем popover статуса (кнопка «Активна»)
    const statusBtn = screen.getByRole('button', { name: /активна/i });
    await userEvent.click(statusBtn);

    // Кликаем «Закрыта» в списке статусов
    const closedOption = await screen.findByRole('button', { name: /закрыта/i });
    await userEvent.click(closedOption);

    // Calendar должен появиться (pendingStatus='closed')
    expect(screen.getByText('Дата закрытия')).toBeInTheDocument();
    // PATCH ещё НЕ вызывался (только 1 вызов — начальная загрузка)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('кнопка «Отмена» в Calendar: статус не меняется, PATCH не вызывается', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([vacancy]));

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await getDataRow();

    const statusBtn = screen.getByRole('button', { name: /активна/i });
    await userEvent.click(statusBtn);

    const closedOption = await screen.findByRole('button', { name: /закрыта/i });
    await userEvent.click(closedOption);

    // Calendar открылся — нажимаем «Отмена»
    await screen.findByText('Дата закрытия');
    const cancelBtn = screen.getByRole('button', { name: /отмена/i });
    await userEvent.click(cancelBtn);

    // Calendar исчез, статус-кнопка показывает исходный статус
    expect(screen.queryByText('Дата закрытия')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /активна/i })).toBeInTheDocument();
    // PATCH не был вызван
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('кнопка «Закрыть» в Calendar: PATCH вызывается с closed_at', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(listResponse([vacancy]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...vacancy, status: 'closed', closed_at: '2026-05-30' } }), { status: 200 }),
      );

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await getDataRow();

    const statusBtn = screen.getByRole('button', { name: /активна/i });
    await userEvent.click(statusBtn);

    const closedOption = await screen.findByRole('button', { name: /закрыта/i });
    await userEvent.click(closedOption);

    await screen.findByText('Дата закрытия');
    const closeBtn = screen.getByRole('button', { name: /^закрыть$/i });
    await userEvent.click(closeBtn);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // Проверяем что PATCH был с правильными полями
    const patchCall = fetchSpy.mock.calls.find(
      ([, opts]) => (opts as RequestInit)?.method === 'PATCH',
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.status).toBe('closed');
    expect(body.closed_at).toBeTruthy();
  });

  it('non-closed статус применяется без Calendar', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(listResponse([vacancy]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...vacancy, status: 'paused' } }), { status: 200 }),
      );

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await getDataRow();

    const statusBtn = screen.getByRole('button', { name: /активна/i });
    await userEvent.click(statusBtn);

    const pausedOption = await screen.findByRole('button', { name: /пауза/i });
    await userEvent.click(pausedOption);

    // PATCH вызван сразу без Calendar
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Дата закрытия')).not.toBeInTheDocument();
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

  it('CSV export с пустым списком: createObjectURL вызван, не падает', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(listResponse([]));
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    global.URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    render(<AdminVacanciesClient role="admin" managers={managers} />);
    await screen.findByText('Вакансий нет.');

    // Кнопка CSV видна даже при пустом списке
    const csvBtn = screen.getByRole('button', { name: /csv/i });
    await userEvent.click(csvBtn);

    // Должен создать Blob только с заголовком (rows=[])
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });
});
