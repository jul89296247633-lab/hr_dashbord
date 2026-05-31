/**
 * Строит diff (insert/update/skip/error) для каждого листа XLSX.
 * Результат сохраняется в template_uploads.preview_data.
 *
 * Каскад матчинга для Data (vacancies):
 *   1. hh_vacancy_id → UPDATE
 *   2. internal_ref → UPDATE (конфиденциальные повторные загрузки)
 *   3. иначе → INSERT
 *
 * Всё читаем через adminClient (service_role) — RLS не мешает видеть все записи.
 */

import { z } from 'zod';
import { parseSheetDate } from '@/lib/google-sheets';
import { detectHomoglyphs, formatHomoglyphWarning } from '@/lib/templates/homoglyph-detector';
import type { ParsedSheet } from '@/lib/templates/xlsx-parser';
import { ROLE_MAP } from '@/lib/templates/schema-mapping';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Типы ──────────────────────────────────────────────────────────────────────

export interface DiffRow {
  row_number: number;
  action: 'insert' | 'update' | 'skip';
  record: Record<string, unknown>;
  warnings: string[]; // омоглифы, отсутствующий менеджер и т.п.
}

export interface DiffError {
  sheet: string;
  row: number;
  column: string;
  reason: string;
}

export interface SheetDiff {
  rows: DiffRow[];
  errors: DiffError[];
  counts: { insert: number; update: number; skip: number; error: number };
}

export interface FullDiff {
  data?: SheetDiff;
  bonus_rates?: SheetDiff;
  hr_list?: SheetDiff;
  staffing_plan?: SheetDiff;
  all_errors: DiffError[];
}

// ── Zod-схемы для строк (минимальная валидация; бизнес-правила ниже) ─────────

const dataRowSchema = z.object({
  'Название вакансии': z.string().min(2, 'Минимум 2 символа').max(200, 'Максимум 200 символов'),
  'ID HH': z.string().optional().default(''),
  'Город': z.string().optional().default(''),
  'Дата открытия': z.string().min(1, 'Дата открытия обязательна'),
  'Дата закрытия': z.string().optional().default(''),
  'Статус': z.string().optional().default(''),
  'Конфиденциальность': z.string().optional().default(''),
  'Менеджеры': z.string().optional().default(''),
  'Подразделение': z.string().optional().default(''),
  'Приоритет': z.string().optional().default(''),
});

const bonusRowSchema = z.object({
  'Должность': z.string().min(2, 'Минимум 2 символа').max(200, 'Максимум 200 символов'),
  'Сумма бонуса (руб)': z.string().min(1, 'Сумма обязательна'),
  'Группа': z.string().optional().default(''),
});

const hrListRowSchema = z.object({
  'ФИО': z.string().min(2, 'Минимум 2 символа').max(100, 'Максимум 100 символов'),
  'Email': z
    .string()
    .min(1, 'Email обязателен')
    .regex(/^[^@]+@[^@]+\.[^@]+$/, 'Некорректный формат email'),
  'Роль': z.string().transform((v, ctx) => {
    const mapped = ROLE_MAP[v.trim().toLowerCase()];
    if (!mapped) {
      ctx.addIssue({ code: 'custom', message: `Неизвестная роль «${v}». Допустимо: manager, head, executive, admin (или: Менеджер, Руководитель HR, Топ-менеджмент, Администратор)` });
      return z.NEVER;
    }
    return mapped;
  }),
  'HH Manager ID': z.string().optional().default(''),
});

const staffingRowSchema = z.object({
  'Город': z.string().min(2, 'Минимум 2 символа').max(100, 'Максимум 100 символов'),
  'Должность': z.string().min(2, 'Минимум 2 символа').max(200, 'Максимум 200 символов'),
  'Кол-во единиц': z.string().min(1, 'Кол-во единиц обязательно'),
  'Занято': z.string().optional().default('0'),
  'Комментарий': z.string().optional().default(''),
});

// ── Вспомогательные ───────────────────────────────────────────────────────────

function normalizeHhId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return null; // игнорируем не-числовые
  return v;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/\s/g, '')       // пробелы-разделители тысяч
    .replace(/₽/g, '')        // знак рубля (global)
    .replace(/руб\.?/gi, '')  // «руб» / «руб.» (global, любой регистр)
    .replace(/,/g, '.')       // запятая → точка (global, после удаления тысячных)
    .trim();
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100); // → kopecks
}

function normalizePriority(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'высокий' || v === 'высокая') return 'высокий';
  if (v === 'средний' || v === 'средняя') return 'средний';
  if (v === 'низкий' || v === 'низкая') return 'низкий';
  return null;
}

// ── Основные diff-построители по типу листа ───────────────────────────────────

export async function buildDataDiff(
  sheet: ParsedSheet,
  db: SupabaseClient,
): Promise<SheetDiff> {
  const rows: DiffRow[] = [];
  const errors: DiffError[] = [];

  // Загружаем существующие вакансии для матчинга (только нужные поля)
  const { data: existingByHhId } = await db
    .from('vacancies')
    .select('id, hh_vacancy_id')
    .not('hh_vacancy_id', 'is', null);
  const hhIdMap = new Map(
    (existingByHhId ?? []).map((v) => [v.hh_vacancy_id as string, v.id as string]),
  );

  // Менеджеры по ФИО (для матчинга колонки «Менеджеры»)
  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, full_name')
    .eq('is_active', true);
  const managerByName = new Map(
    (profiles ?? []).map((p) => [p.full_name.trim().toLowerCase(), p.id as string]),
  );

  // Дубли hh_vacancy_id внутри загружаемого файла
  const seenHhIds = new Set<string>();

  for (const { rowNumber, values } of sheet.rows) {
    const sheetName = 'Data';
    const parsed = dataRowSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ sheet: sheetName, row: rowNumber, column: issue.path[0] as string, reason: issue.message });
      continue;
    }
    const v = parsed.data;
    const warnings: string[] = [];

    // Дата открытия (обязательна)
    const openedAt = parseSheetDate(v['Дата открытия']);
    if (!openedAt) {
      errors.push({ sheet: sheetName, row: rowNumber, column: 'Дата открытия', reason: `Неверный формат даты: «${v['Дата открытия']}» (ожидается ДД.ММ.ГГГГ)` });
      continue;
    }

    const closedAt = v['Дата закрытия'] ? parseSheetDate(v['Дата закрытия']) : null;
    if (v['Дата закрытия'] && !closedAt) {
      errors.push({ sheet: sheetName, row: rowNumber, column: 'Дата закрытия', reason: `Неверный формат даты: «${v['Дата закрытия']}» (ожидается ДД.ММ.ГГГГ)` });
      continue;
    }

    const hhId = normalizeHhId(v['ID HH']);
    const statusRaw = v['Статус'].trim().toLowerCase();
    const status = statusRaw === 'закрыта' ? 'closed' : 'active';
    const confRaw = v['Конфиденциальность'].trim().toLowerCase();
    const confidentiality: 'confidential' | 'open' = confRaw === 'да' ? 'confidential' : 'open';

    // Омоглифы в названии
    const titleHits = detectHomoglyphs(v['Название вакансии']);
    if (titleHits.length > 0) {
      warnings.push(`Название вакансии: ${formatHomoglyphWarning(titleHits)}`);
    }

    // Дубль hh_vacancy_id внутри файла
    if (hhId) {
      if (seenHhIds.has(hhId)) {
        errors.push({ sheet: sheetName, row: rowNumber, column: 'ID HH', reason: `Дублирующийся hh_vacancy_id ${hhId} в этом файле` });
        continue;
      }
      seenHhIds.add(hhId);
    }

    // Предупреждение: открытая вакансия без HH ID
    if (confidentiality === 'open' && !hhId) {
      warnings.push('Открытая вакансия без ID HH — рекомендуется заполнить');
    }

    // Матчинг менеджера
    const managerRaw = v['Менеджеры'].trim();
    let managerId: string | null = null;
    if (managerRaw) {
      managerId = managerByName.get(managerRaw.toLowerCase()) ?? null;
      if (!managerId) {
        warnings.push(`Менеджер «${managerRaw}» не найден в системе — manager_id будет NULL`);
      }
    }

    // Каскадный матч: hh_vacancy_id → internal_ref → INSERT
    let action: 'insert' | 'update' = 'insert';
    let existingId: string | null = null;
    if (hhId && hhIdMap.has(hhId)) {
      action = 'update';
      existingId = hhIdMap.get(hhId)!;
    }

    const location = v['Город'].trim() || null;
    const subdivision = v['Подразделение'].trim() || null;
    const priority = normalizePriority(v['Приоритет']);

    rows.push({
      row_number: rowNumber,
      action,
      warnings,
      record: {
        existing_id: existingId,
        title: v['Название вакансии'].trim(),
        hh_vacancy_id: hhId,
        location,
        opened_at: openedAt,
        closed_at: closedAt,
        status,
        confidentiality,
        needs_internal_ref: confidentiality === 'confidential' && !hhId && !existingId,
        manager_id: managerId,
        subdivision,
        priority,
      },
    });
  }

  const counts = {
    insert: rows.filter((r) => r.action === 'insert').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: 0,
    error: errors.length,
  };
  return { rows, errors, counts };
}

export async function buildBonusRatesDiff(
  sheet: ParsedSheet,
  db: SupabaseClient,
): Promise<SheetDiff> {
  const rows: DiffRow[] = [];
  const errors: DiffError[] = [];

  const { data: existing } = await db.from('bonus_rates').select('id, position_name');
  const byName = new Map((existing ?? []).map((r) => [r.position_name as string, r.id as string]));

  for (const { rowNumber, values } of sheet.rows) {
    const parsed = bonusRowSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ sheet: 'Бонусы_HR', row: rowNumber, column: issue.path[0] as string, reason: issue.message });
      continue;
    }
    const v = parsed.data;
    const warnings: string[] = [];

    const amountKopecks = parseAmount(v['Сумма бонуса (руб)']);
    if (amountKopecks === null) {
      errors.push({ sheet: 'Бонусы_HR', row: rowNumber, column: 'Сумма бонуса (руб)', reason: `Неверный формат суммы: «${v['Сумма бонуса (руб)']}»` });
      continue;
    }

    const hits = detectHomoglyphs(v['Должность']);
    if (hits.length > 0) warnings.push(`Должность: ${formatHomoglyphWarning(hits)}`);

    const positionName = v['Должность'].trim();
    const existingId = byName.get(positionName) ?? null;

    rows.push({
      row_number: rowNumber,
      action: existingId ? 'update' : 'insert',
      warnings,
      record: {
        existing_id: existingId,
        position_name: positionName,
        amount_kopecks: amountKopecks,
        group_name: v['Группа'].trim() || null,
      },
    });
  }

  const counts = {
    insert: rows.filter((r) => r.action === 'insert').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: 0,
    error: errors.length,
  };
  return { rows, errors, counts };
}

export async function buildHrListDiff(
  sheet: ParsedSheet,
  db: SupabaseClient,
): Promise<SheetDiff> {
  const rows: DiffRow[] = [];
  const errors: DiffError[] = [];

  const { data: existing } = await db.from('user_profiles').select('id, email');
  const byEmail = new Map(
    (existing ?? []).map((p) => [p.email.trim().toLowerCase(), p.id as string]),
  );

  const { data: existingSyncs } = await db
    .from('hr_manager_syncs')
    .select('id, sheet_full_name, hh_manager_id');
  const syncByName = new Map(
    (existingSyncs ?? []).map((s) => [s.sheet_full_name.trim().toLowerCase(), s.id as string]),
  );
  const syncByHhId = new Map(
    (existingSyncs ?? []).filter((s) => s.hh_manager_id).map((s) => [s.hh_manager_id!, s.id as string]),
  );

  for (const { rowNumber, values } of sheet.rows) {
    const parsed = hrListRowSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ sheet: 'Список HR', row: rowNumber, column: issue.path[0] as string, reason: issue.message });
      continue;
    }
    const v = parsed.data;
    const warnings: string[] = [];

    const hits = detectHomoglyphs(v['ФИО']);
    if (hits.length > 0) warnings.push(`ФИО: ${formatHomoglyphWarning(hits)}`);

    const email = v['Email'].trim().toLowerCase();
    const fullName = v['ФИО'].trim();
    const hhId = v['HH Manager ID'].trim() || null;
    const profileId = byEmail.get(email) ?? null;
    const syncId = syncByName.get(fullName.toLowerCase()) ?? (hhId ? (syncByHhId.get(hhId) ?? null) : null);

    if (!profileId) {
      warnings.push('Пользователь с таким email не найден в системе — будет создана запись в hr_manager_syncs без привязки к аккаунту');
    }

    rows.push({
      row_number: rowNumber,
      action: syncId ? 'update' : 'insert',
      warnings,
      record: {
        existing_sync_id: syncId,
        existing_profile_id: profileId,
        full_name: fullName,
        email: v['Email'].trim(),
        role: v['Роль'],
        hh_manager_id: hhId,
      },
    });
  }

  const counts = {
    insert: rows.filter((r) => r.action === 'insert').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: 0,
    error: errors.length,
  };
  return { rows, errors, counts };
}

export async function buildStaffingPlanDiff(
  sheet: ParsedSheet,
  db: SupabaseClient,
): Promise<SheetDiff> {
  const rows: DiffRow[] = [];
  const errors: DiffError[] = [];

  const { data: existing } = await db
    .from('staffing_plan')
    .select('id, city, position_name');
  const byKey = new Map(
    (existing ?? []).map((r) => [`${r.city}|${r.position_name}`, r.id as string]),
  );

  for (const { rowNumber, values } of sheet.rows) {
    const parsed = staffingRowSchema.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ sheet: 'Штатное расписание', row: rowNumber, column: issue.path[0] as string, reason: issue.message });
      continue;
    }
    const v = parsed.data;
    const warnings: string[] = [];

    const rawUnits = v['Кол-во единиц'].replace(/\s/g, '');
    if (!/^\d+$/.test(rawUnits)) {
      errors.push({ sheet: 'Штатное расписание', row: rowNumber, column: 'Кол-во единиц', reason: `Должно быть целым числом от 0 до 999, получено: «${v['Кол-во единиц']}»` });
      continue;
    }
    const plannedUnits = parseInt(rawUnits, 10);
    if (plannedUnits < 0 || plannedUnits > 999) {
      errors.push({ sheet: 'Штатное расписание', row: rowNumber, column: 'Кол-во единиц', reason: `Должно быть от 0 до 999, получено: ${plannedUnits}` });
      continue;
    }

    const rawOccupied = v['Занято'].replace(/\s/g, '') || '0';
    if (!/^\d+$/.test(rawOccupied)) {
      errors.push({ sheet: 'Штатное расписание', row: rowNumber, column: 'Занято', reason: `Должно быть целым числом от 0 до 999, получено: «${v['Занято']}»` });
      continue;
    }
    const occupiedUnits = parseInt(rawOccupied, 10);
    if (occupiedUnits < 0 || occupiedUnits > 999) {
      errors.push({ sheet: 'Штатное расписание', row: rowNumber, column: 'Занято', reason: `Должно быть от 0 до 999, получено: ${occupiedUnits}` });
      continue;
    }

    const hits = detectHomoglyphs(v['Должность']);
    if (hits.length > 0) warnings.push(`Должность: ${formatHomoglyphWarning(hits)}`);

    const city = v['Город'].trim();
    const positionName = v['Должность'].trim();
    const key = `${city}|${positionName}`;
    const existingId = byKey.get(key) ?? null;

    rows.push({
      row_number: rowNumber,
      action: existingId ? 'update' : 'insert',
      warnings,
      record: {
        existing_id: existingId,
        city,
        position_name: positionName,
        planned_units: plannedUnits,
        // occupied_units НЕ кладём: заполненность вычисляется из привязанных
        // вакансий (FEATURE_SPEC_auto_staffing). «Занято» валидируется выше, но
        // в БД не пишется.
        comment: v['Комментарий'].trim() || null,
      },
    });
  }

  const counts = {
    insert: rows.filter((r) => r.action === 'insert').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: 0,
    error: errors.length,
  };
  return { rows, errors, counts };
}
