import {
  getAuthUser,
  requireRole,
  apiSuccess,
  handleApiError,
} from '@/lib/api-helpers';
import { readSheetMeta, VACANCIES_TAB } from '@/lib/google-sheets';

/**
 * POST /api/admin/integrations/sheets/test — проверка доступа к Google Sheets (только admin).
 * Читает заголовки вкладки «Вакансии» через service account. Ошибки доступа
 * возвращаются в теле (ok:false) — это диагностический эндпоинт, не сбой запроса.
 */
export async function POST() {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const tab = VACANCIES_TAB();
    const startedAt = Date.now();
    try {
      const { headers, totalRows } = await readSheetMeta(tab);
      return apiSuccess({
        data: {
          ok: true,
          sheet_title: tab,
          total_rows: totalRows,
          headers_found: headers,
          response_ms: Date.now() - startedAt,
        },
      });
    } catch (sheetsErr) {
      const message = sheetsErr instanceof Error ? sheetsErr.message : 'Неизвестная ошибка';
      return apiSuccess({
        data: {
          ok: false,
          error: message,
          hint: 'Добавьте service account email как читателя в настройках доступа к таблице',
        },
      });
    }
  } catch (err) {
    return handleApiError(err);
  }
}
