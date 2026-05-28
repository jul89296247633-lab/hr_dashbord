import { type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import {
  getAuthUser,
  requireRole,
  apiSuccess,
  apiError,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseXlsxBuffer } from '@/lib/templates/xlsx-parser';
import { SHEET_NAMES, type SheetType } from '@/lib/templates/schema-mapping';
import {
  buildDataDiff,
  buildBonusRatesDiff,
  buildHrListDiff,
  buildStaffingPlanDiff,
  type SheetDiff,
} from '@/lib/templates/diff-builder';

/**
 * POST /api/templates/upload
 * Принимает XLSX-файл, парсит, строит превью diff.
 * Авторизация: head | admin.
 *
 * Body: multipart/form-data, поле `file` — XLSX-файл.
 *
 * Алгоритм:
 * 1. Вычисляем SHA-256 файла → предупреждение если уже загружался.
 * 2. Парсим листы через SheetJS.
 * 3. Для каждого найденного листа строим diff (buildXxxDiff).
 * 4. Сохраняем record в template_uploads (status='previewed') с preview_data.
 * 5. Возвращаем preview + errors.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return apiError('NO_FILE', 'Передайте файл в поле «file» (multipart/form-data)', 422);
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return apiError('INVALID_FILE_TYPE', 'Файл должен быть в формате XLSX', 422);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.byteLength === 0) {
      return apiError('EMPTY_FILE', 'Файл пустой', 422);
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    const supabase = await createClient();
    const db = createAdminClient();

    // Предупреждение о повторной загрузке (idempotency)
    let duplicateWarning: string | null = null;
    const { data: dupCheck } = await supabase
      .from('template_uploads')
      .select('id, created_at')
      .eq('file_hash', fileHash)
      .eq('status', 'applied')
      .order('created_at', { ascending: false })
      .limit(1);
    if (dupCheck && dupCheck.length > 0) {
      const when = new Date(dupCheck[0].created_at).toLocaleDateString('ru-RU');
      duplicateWarning = `Этот файл уже загружался ${when}`;
    }

    // Парсим XLSX
    let sheets;
    try {
      sheets = parseXlsxBuffer(buffer);
    } catch {
      return apiError('PARSE_ERROR', 'Файл не распознан как XLSX. Убедитесь что файл не повреждён.', 422);
    }

    const sheetByName = new Map(sheets.map((s) => [s.name, s]));

    // Определяем тип загрузки по набору присутствующих листов
    const presentTypes = (Object.keys(SHEET_NAMES) as SheetType[]).filter(
      (t) => sheetByName.has(SHEET_NAMES[t]),
    );

    if (presentTypes.length === 0) {
      const expected = (Object.values(SHEET_NAMES) as string[]).join(', ');
      return apiError(
        'NO_KNOWN_SHEETS',
        `Ни один ожидаемый лист не найден. Ожидаются: ${expected}`,
        422,
      );
    }

    const templateType = presentTypes.length > 1 ? 'combined' : presentTypes[0];

    // Строим diff для каждого найденного листа
    const diffs: Partial<Record<SheetType, SheetDiff>> = {};
    const allErrors: SheetDiff['errors'] = [];

    for (const sheetType of presentTypes) {
      const parsedSheet = sheetByName.get(SHEET_NAMES[sheetType])!;

      switch (sheetType) {
        case 'data':
          diffs.data = await buildDataDiff(parsedSheet, db);
          break;
        case 'bonus_rates':
          diffs.bonus_rates = await buildBonusRatesDiff(parsedSheet, db);
          break;
        case 'hr_list':
          diffs.hr_list = await buildHrListDiff(parsedSheet, db);
          break;
        case 'staffing_plan':
          diffs.staffing_plan = await buildStaffingPlanDiff(parsedSheet, db);
          break;
      }

      allErrors.push(...(diffs[sheetType]?.errors ?? []));
    }

    // Суммарные счётчики для template_uploads
    const totals = (Object.values(diffs) as SheetDiff[]).reduce(
      (acc, d) => ({
        total: acc.total + d.rows.length + d.errors.length,
        inserted: acc.inserted + d.counts.insert,
        updated: acc.updated + d.counts.update,
        skipped: acc.skipped + d.counts.skip,
        errors: acc.errors + d.counts.error,
      }),
      { total: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 },
    );

    // preview_data: только валидные строки (rows), ошибки хранятся в error_report
    const previewData: Record<string, unknown[]> = {};
    if (diffs.data) previewData.data = diffs.data.rows;
    if (diffs.bonus_rates) previewData.bonus_rates = diffs.bonus_rates.rows;
    if (diffs.hr_list) previewData.hr_list = diffs.hr_list.rows;
    if (diffs.staffing_plan) previewData.staffing_plan = diffs.staffing_plan.rows;

    // Создаём запись template_uploads
    const { data: upload, error: uploadError } = await supabase
      .from('template_uploads')
      .insert({
        uploaded_by: user.id,
        template_type: templateType,
        file_name: file.name,
        file_hash: fileHash,
        rows_total: totals.total,
        rows_inserted: totals.inserted,
        rows_updated: totals.updated,
        rows_skipped: totals.skipped,
        rows_error: totals.errors,
        status: 'previewed',
        error_report: allErrors.length > 0 ? (allErrors as unknown as import('@/types/database').Json) : null,
        preview_data: previewData as unknown as import('@/types/database').Json,
      })
      .select('id')
      .single();

    if (uploadError || !upload) {
      throw new ApiError(500, 'DB_ERROR', uploadError?.message ?? 'Ошибка сохранения превью');
    }

    // Формируем ответ
    const preview: Record<string, { insert: number; update: number; skip: number; error: number }> = {};
    if (diffs.data) preview.data = diffs.data.counts;
    if (diffs.bonus_rates) preview.bonus_rates = diffs.bonus_rates.counts;
    if (diffs.hr_list) preview.hr_list = diffs.hr_list.counts;
    if (diffs.staffing_plan) preview.staffing_plan = diffs.staffing_plan.counts;

    return apiSuccess({
      data: {
        upload_id: upload.id,
        ...(duplicateWarning ? { warning: duplicateWarning } : {}),
        preview,
        errors: allErrors,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
