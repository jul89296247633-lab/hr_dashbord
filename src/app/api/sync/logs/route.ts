import { type NextRequest } from 'next/server';
import {
  getAuthUser,
  requireRole,
  apiError,
  apiSuccess,
  handleApiError,
  ApiError,
} from '@/lib/api-helpers';
import { createClient } from '@/lib/supabase/server';
import { syncLogsQuerySchema } from '@/lib/validations';

/**
 * GET /api/sync/logs — журнал синхронизаций (head, admin). DESC по started_at.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const sp = request.nextUrl.searchParams;
    const parsed = syncLogsQuerySchema.safeParse({
      source: sp.get('source') ?? undefined,
      status: sp.get('status') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { source, status, page, per_page } = parsed.data;

    const supabase = await createClient();
    let query = supabase.from('sync_logs').select('*', { count: 'exact' });
    if (source) query = query.eq('source', source);
    if (status) query = query.eq('status', status);

    const from = (page - 1) * per_page;
    query = query.order('started_at', { ascending: false }).range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({
      data: data ?? [],
      meta: { total: count ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
