/**
 * SheetJS-обёртка для парсинга XLSX и генерации пустых шаблонов.
 * Используется только на сервере (API routes).
 */

import * as XLSX from 'xlsx';

export interface ParsedSheet {
  name: string;
  headers: string[];
  /** Строки данных (без заголовка). Ключ = заголовок колонки, значение = строка. */
  rows: Array<{ rowNumber: number; values: Record<string, string> }>;
}

/**
 * Парсит Buffer XLSX-файла и возвращает все листы.
 * raw: false → все ячейки как строки (даты, числа не преобразуются в JS-типы).
 * Строки, где все значения пусты, пропускаются.
 */
export function parseXlsxBuffer(buffer: Buffer): ParsedSheet[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];

    if (rawRows.length === 0) return { name, headers: [], rows: [] };

    const headers = rawRows[0].map((h) => String(h ?? '').trim());
    const dataRows: ParsedSheet['rows'] = [];

    for (let i = 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const values: Record<string, string> = {};
      let hasValue = false;

      headers.forEach((h, colIdx) => {
        const val = String(raw[colIdx] ?? '').trim();
        if (h) values[h] = val;
        if (val) hasValue = true;
      });

      if (hasValue) {
        // rowNumber — 1-based номер строки в XLSX (1 = заголовок → данные с 2)
        dataRows.push({ rowNumber: i + 1, values });
      }
    }

    return { name, headers, rows: dataRows };
  });
}

/**
 * Генерирует XLSX-буфер с заголовками (пустой шаблон для скачивания).
 * Каждый sheet: первая строка — заголовки, данных нет.
 */
export function generateTemplateXlsx(
  sheets: Array<{ name: string; columns: readonly string[] }>,
): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const { name, columns } of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet([Array.from(columns)]);
    // Минимальная ширина колонок для читаемости
    worksheet['!cols'] = columns.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Генерирует XLSX-буфер отчёта об ошибках.
 * Колонки: Лист | Строка | Колонка | Причина
 */
export function generateErrorReportXlsx(
  errors: Array<{ sheet: string; row: number; column: string; reason: string }>,
): Buffer {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ['Лист', 'Строка', 'Колонка', 'Причина'],
    ...errors.map((e) => [e.sheet, e.row, e.column, e.reason]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 20 }, { wch: 8 }, { wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Ошибки');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
