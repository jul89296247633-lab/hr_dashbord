import iconv from 'iconv-lite';

/**
 * Парсинг CSV-выгрузок HH «Аналитика подбора». См. SPEC §5.5b.
 * Только серверный код.
 *
 * Архитектура (изменена с OAuth API на CSV):
 *  - HH перестал отдавать отдельные отчёты «звонки» / «индекс компании»;
 *    остались только два аналитических CSV — менеджеры и вакансии.
 *  - Кодировка новых файлов — UTF-8 (с BOM), а не windows-1251.
 *    Поэтому `decodeCsv` пытается UTF-8 первым (по BOM-маркеру),
 *    fallback — windows-1251 для устаревших отчётов.
 *  - Разделитель: `;`. Числа: запятая как десятичный (0,14 → 0.14).
 *  - Индекс вежливости приходит строкой вида `"97%"` → используем parsePercent.
 */

export type HHReportType =
  | 'politeness_managers'  // recruitment_analytics_managers_statistics
  | 'vacancies';           // recruitment_analytics_vacancies

/**
 * Ожидаемые колонки по типу отчёта (минимум для валидации формата).
 * Проверка через `includes()` — допускает мелкие хвосты типа «, шт.».
 */
export const EXPECTED_COLUMNS: Record<HHReportType, string[]> = {
  // recruitment_analytics_managers_statistics_*.csv
  // Реальные заголовки HH: "Менеджер" | "id менеджера" | "Индекс вежливости"
  // (формат значения "97%"). Дополнительные колонки (Отклики, шт. / Просмотры
  // резюме из отклика, шт. / Приглашений из откликов, шт.) парсим как nullable.
  politeness_managers: ['Менеджер', 'id менеджера', 'Индекс вежливости'],

  // recruitment_analytics_vacancies_*.csv
  // Реальные заголовки HH: "id вакансии" | "Название вакансии" | "Архивная" |
  // "Фактическая дата архивации" | "Менеджеры" | "Показы" | "Просмотры" |
  // "Отклики" | "Приглашения из откликов" | "Звонки" | "Просмотры резюме из отклика"
  vacancies: ['id вакансии', 'Показы', 'Просмотры', 'Отклики', 'Приглашения из откликов'],
};

/** windows-1251 Buffer → UTF-8 строка (для устаревших отчётов HH). */
export function decodeWin1251(buffer: Buffer): string {
  return iconv.decode(buffer, 'win1251');
}

/**
 * Универсальный декод: пытается UTF-8 (если есть BOM ﻿ в начале),
 * иначе fallback на windows-1251. Новые аналитические CSV — UTF-8 BOM.
 */
export function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (utf8.charCodeAt(0) === 0xfeff) return utf8.slice(1);
  // Без BOM считаем что это устаревший формат — windows-1251.
  return decodeWin1251(buffer);
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
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Парсит процент из CSV-ячейки. HH отдаёт «Индекс вежливости» как `"97%"`.
 * Возвращает 0–100 (как и поле БД `politeness_index`). Пустое/«-» → null.
 */
export function parsePercent(value: string): number | null {
  return parseNumber((value ?? '').replace('%', ''));
}

/**
 * Булева проверка для CSV-полей вида «Да»/«Нет» (используется в `Архивная`).
 */
export function parseBoolYesNo(value: string): boolean {
  return (value ?? '').trim().toLowerCase() === 'да';
}
