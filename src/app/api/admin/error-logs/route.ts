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
import { errorLogsQuerySchema } from '@/lib/validations';

/**
 * GET /api/admin/error-logs — журнал ошибок приложения (только admin).
 * DESC по created_at. Фильтры: source, severity, resolved, date_from, date_to.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const sp = request.nextUrl.searchParams;
    const parsed = errorLogsQuerySchema.safeParse({
      source: sp.get('source') ?? undefined,
      severity: sp.get('severity') ?? undefined,
      resolved: sp.get('resolved') ?? undefined,
      date_from: sp.get('date_from') ?? undefined,
      date_to: sp.get('date_to') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { source, severity, resolved, date_from, date_to, page, per_page } = parsed.data;

    const supabase = await createClient();
    let query = supabase.from('error_logs').select('*', { count: 'exact' });
    if (source) query = query.eq('source', source);
    if (severity) query = query.eq('severity', severity);
    if (resolved !== undefined) query = query.eq('resolved', resolved);
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

    const from = (page - 1) * per_page;
    query = query.order('created_at', { ascending: false }).range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Счётчик неразрешённых (для бейджа).
    const { count: unresolved, error: unresolvedError } = await supabase
      .from('error_logs')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false);
    if (unresolvedError) throw new ApiError(500, 'DB_ERROR', unresolvedError.message);

    return apiSuccess({
      data: data ?? [],
      meta: { total: count ?? 0, unresolved: unresolved ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
