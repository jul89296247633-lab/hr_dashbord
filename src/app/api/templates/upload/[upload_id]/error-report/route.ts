import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser, handleApiError, apiError } from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { generateErrorReportXlsx } from '@/lib/templates/xlsx-parser';
import { uuidSchema } from '@/lib/validations';

/**
 * GET /api/templates/upload/[upload_id]/error-report
 * Скачать XLSX-отчёт об ошибках для заданной загрузки.
 * Авторизация: head | admin (через RLS SELECT: загрузчик или head/admin/executive).
 *
 * Если ошибок нет — 204 No Content.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ upload_id: string }> },
) {
  try {
    await getAuthUser();

    const { upload_id } = await params;
    if (!uuidSchema.safeParse(upload_id).success) {
      return apiError('UPLOAD_NOT_FOUND', 'Загрузка не найдена', 404);
    }

    const supabase = await createClient();
    const { data: upload, error } = await supabase
      .from('template_uploads')
      .select('id, file_name, error_report')
      .eq('id', upload_id)
      .single();

    if (error || !upload) {
      return apiError('UPLOAD_NOT_FOUND', 'Загрузка не найдена', 404);
    }

    const errors = upload.error_report as Array<{
      sheet: string;
      row: number;
      column: string;
      reason: string;
    }> | null;

    if (!errors || errors.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    const buffer = generateErrorReportXlsx(errors);
    const baseName = (upload.file_name ?? 'template').replace(/\.xlsx$/i, '');
    const filename = encodeURIComponent(`Ошибки_${baseName}.xlsx`);

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
