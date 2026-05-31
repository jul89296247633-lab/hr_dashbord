import {
  getAuthUser,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/vacancies/requests/options
 * Источник datalist-автодополнения для формы заявки: уникальные непустые
 * значения title / location / subdivision из существующих вакансий.
 * Справочные данные (не персональные) → читаем service-role, чтобы автор-manager
 * видел общий список, а не только свои вакансии. TOP-200 каждого.
 */
export async function GET() {
  try {
    await getAuthUser();

    const db = createAdminClient();
    const { data, error } = await db
      .from('vacancies')
      .select('title, location, subdivision')
      .limit(2000);
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const uniqSorted = (vals: (string | null)[]): string[] =>
      Array.from(
        new Set(vals.map((v) => (v ?? '').trim()).filter((v) => v.length > 0)),
      )
        .sort((a, b) => a.localeCompare(b, 'ru'))
        .slice(0, 200);

    const rows = data ?? [];
    return apiSuccess({
      data: {
        titles: uniqSorted(rows.map((r) => r.title)),
        locations: uniqSorted(rows.map((r) => r.location)),
        subdivisions: uniqSorted(rows.map((r) => r.subdivision)),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
