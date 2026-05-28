import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleApiError, apiError } from '@/lib/api-helpers';
import {
  SHEET_NAMES,
  COLUMNS_BY_SHEET,
  COMBINED_SHEETS,
  type TemplateType,
  type SheetType,
} from '@/lib/templates/schema-mapping';
import { generateTemplateXlsx } from '@/lib/templates/xlsx-parser';

const VALID_TYPES: TemplateType[] = ['data', 'bonus_rates', 'hr_list', 'staffing_plan', 'combined'];

/**
 * GET /api/templates/[type]/download
 * Генерирует и отдаёт пустой XLSX-шаблон с заголовками.
 * Авторизация: любой залогиненный (шаблон — публичный документ онбординга).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  try {
    await getAuthUser();

    const { type } = await params;
    if (!VALID_TYPES.includes(type as TemplateType)) {
      return apiError(
        'INVALID_TEMPLATE_TYPE',
        `Тип шаблона должен быть: ${VALID_TYPES.join(' | ')}`,
        400,
      );
    }

    const templateType = type as TemplateType;

    const sheets =
      templateType === 'combined'
        ? COMBINED_SHEETS.map((s) => ({ name: SHEET_NAMES[s], columns: COLUMNS_BY_SHEET[s] }))
        : [{ name: SHEET_NAMES[templateType as SheetType], columns: COLUMNS_BY_SHEET[templateType as SheetType] }];

    const buffer = generateTemplateXlsx(sheets);

    const fileLabel =
      templateType === 'combined' ? 'combined' : SHEET_NAMES[templateType as SheetType];
    const filename = encodeURIComponent(`Шаблон_${fileLabel}.xlsx`);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
