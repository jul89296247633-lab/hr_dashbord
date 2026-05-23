import iconv from 'iconv-lite';

/**
 * Парсинг CSV-выгрузок HH «Аналитика подбора». Кодировка windows-1251.
 * См. SPEC §5.5b. Только серверный код.
 */

export type HHReportType = 'calls' | 'politeness_managers' | 'politeness_company';

/** Ожидаемые колонки по типу отчёта (для валидации формата). */
export const EXPECTED_COLUMNS: Record<HHReportType, string[]> = {
  calls: ['Менеджер', 'Количество звонков'],
  politeness_managers: [
    'Менеджер',
    'Индекс вежливости',
    'Получено откликов',
    'Отмечено просмотренными',
    'Отправлено ответов',
    'Среднее время ответа',
  ],
  politeness_company: [
    'Индекс вежливости',
    'Получено откликов',
    'Отмечено просмотренными',
    'Отправлено ответов',
  ],
};

/** windows-1251 Buffer → UTF-8 строка. */
export function decodeWin1251(buffer: Buffer): string {
  return iconv.decode(buffer, 'win1251');
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Парсит CSV-текст. Делимитер автоопределяется (`;` или `,`). Учитывает кавычки. */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',';
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());

  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj;
  });

  return { headers, rows };
}

/** Разбивает строку CSV с учётом кавычек и экранирования "". */
function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Проверяет наличие обязательных колонок отчёта. */
export function hasExpectedColumns(headers: string[], reportType: HHReportType): boolean {
  const norm = headers.map((h) => h.toLowerCase().trim());
  return EXPECTED_COLUMNS[reportType].every((col) =>
    norm.some((h) => h.includes(col.toLowerCase())),
  );
}

/** Нормализация ФИО для сопоставления (lower, ё→е, схлопывание пробелов). */
export function normalizeName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Парсит число из CSV-ячейки (запятая как десятичный разделитель). */
export function parseNumber(value: string): number | null {
  const cleaned = (value ?? '').replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
