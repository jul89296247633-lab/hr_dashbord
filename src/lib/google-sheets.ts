import { google } from 'googleapis';

/**
 * Чтение Google Sheets API v4 через service account (read-only).
 * Используется только на сервере (sync-роуты, cron). См. SPEC §5.6.
 *
 * Имена вкладок берутся из env:
 *   GOOGLE_SHEETS_VACANCIES_TAB ('Вакансии')
 *   GOOGLE_SHEETS_MANAGERS_TAB  ('HR менеджеры')
 *   GOOGLE_SHEETS_BONUSES_TAB   ('Бонусы_HR')
 */

export interface SheetRow {
  rowIndex: number; // 1-based номер строки в Sheets (1 — заголовок, данные с 2)
  values: Record<string, string>;
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID не задан');
  return id;
}

/** Читает вкладку как массив строк-объектов (ключ — заголовок столбца). */
export async function readSheetTab(tabName: string): Promise<SheetRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A:Z`,
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = (rows[0] as string[]).map((h) => String(h).trim());
  return rows.slice(1).map((row, idx) => {
    const values: Record<string, string> = {};
    headers.forEach((h, i) => {
      values[h] = String((row as string[])[i] ?? '').trim();
    });
    return { rowIndex: idx + 2, values };
  });
}

/** Метаданные вкладки для теста доступа (admin/integrations/sheets/test). */
export async function readSheetMeta(
  tabName: string,
): Promise<{ headers: string[]; totalRows: number }> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A:Z`,
  });
  const rows = res.data.values ?? [];
  return {
    headers: rows.length > 0 ? (rows[0] as string[]).map((h) => String(h).trim()) : [],
    totalRows: Math.max(rows.length - 1, 0),
  };
}

export const VACANCIES_TAB = () => process.env.GOOGLE_SHEETS_VACANCIES_TAB ?? 'Вакансии';
export const MANAGERS_TAB = () => process.env.GOOGLE_SHEETS_MANAGERS_TAB ?? 'HR менеджеры';
export const BONUSES_TAB = () => process.env.GOOGLE_SHEETS_BONUSES_TAB ?? 'Бонусы_HR';

/** 'DD.MM.YYYY' → 'YYYY-MM-DD'. Пустая/неполная строка → null. */
export function parseSheetDate(value: string): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const [d, m, y] = v.split('.');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Сумма в рублях из Sheets → копейки. '50 000', '50000,50' → INTEGER коп. */
export function rublesToKopecks(value: string): number {
  const cleaned = (value ?? '').replace(/\s/g, '').replace(',', '.');
  const rub = Number.parseFloat(cleaned);
  if (!Number.isFinite(rub)) return 0;
  return Math.round(rub * 100);
}
