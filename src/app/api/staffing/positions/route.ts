import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/staffing/positions — справочник штатки для формы заявки на вакансию.
 * Доступно любому авторизованному (заявку создаёт любой; FEATURE_SPEC_auto_staffing).
 *
 *   • без ?city          → список городов, у которых есть строки штатки
 *                          (для первого селекта формы).
 *   • ?city=<city>       → позиции штатки этого города:
 *                          [{ id, position_name }] для дропдауна должностей →
 *                          выбор даёт vacancies.staffing_plan_id.
 *
 * Источник = staffing_plan (под RLS; план — прозрачный документ, читаем всем).
 */
export async function GET(request: NextRequest) {
  try {
    await getAuthUser();

    const city = request.nextUrl.searchParams.get('city')?.trim() || null;
    const supabase = await createClient();

    if (!city) {
      // Список городов со штаткой (DISTINCT на клиенте — supabase-js без .distinct()).
      const { data, error } = await supabase
        .from('staffing_plan')
        .select('city')
        .order('city');
      if (error) throw new ApiError(500, 'DB_ERROR', error.message);

      const cities = Array.from(
        new Set((data ?? []).map((r) => (r.city ?? '').trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, 'ru'));

      return apiSuccess({ data: { cities } });
    }

    const { data, error } = await supabase
      .from('staffing_plan')
      .select('id, position_name')
      .eq('city', city)
      .order('position_name');
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    const positions = (data ?? []).map((r) => ({
      id: r.id,
      position_name: r.position_name,
    }));

    return apiSuccess({ data: { positions } });
  } catch (err) {
    return handleApiError(err);
  }
}
