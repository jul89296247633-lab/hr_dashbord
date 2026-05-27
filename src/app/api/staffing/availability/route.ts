import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { staffingAvailabilityQuerySchema } from '@/lib/validations';
import type { StaffingAvailabilityResponse } from '@/types';

/**
 * GET /api/staffing/availability?location=<city> — заполненность по одному городу.
 * Используется виджетом штатной сверки в форме заявки на вакансию.
 *
 * Источник = RPC compute_staffing_plan(p_city=<city>) (см. /api/staffing/plan).
 * Если штат по городу не задан — rows=[], виджет показывает «Штат по городу не задан».
 */
export async function GET(request: NextRequest) {
  try {
    await getAuthUser();

    const parsed = staffingAvailabilityQuerySchema.safeParse({
      location: request.nextUrl.searchParams.get('location') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { location } = parsed.data;

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('compute_staffing_plan', {
      p_city: location,
      p_threshold: 0.4,
    });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    type RpcRow = {
      id: string;
      city: string;
      position_name: string;
      planned_units: number;
      occupied: number;
      in_progress: number;
      vacant: number;
    };

    const rows = (data as RpcRow[] | null) ?? [];
    const response: StaffingAvailabilityResponse = {
      location,
      rows: rows.map((r) => ({
        position_name: r.position_name,
        planned: r.planned_units,
        occupied: r.occupied,
        in_progress: r.in_progress,
        vacant: r.vacant,
      })),
    };

    return apiSuccess({ data: response });
  } catch (err) {
    return handleApiError(err);
  }
}
