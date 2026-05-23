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
import { auditLogsQuerySchema } from '@/lib/validations';

/**
 * GET /api/admin/audit-logs — audit trail (только admin). DESC по created_at.
 * Фильтры: table_name, record_id, user_id, action, date_from, date_to.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const sp = request.nextUrl.searchParams;
    const parsed = auditLogsQuerySchema.safeParse({
      table_name: sp.get('table_name') ?? undefined,
      record_id: sp.get('record_id') ?? undefined,
      user_id: sp.get('user_id') ?? undefined,
      action: sp.get('action') ?? undefined,
      date_from: sp.get('date_from') ?? undefined,
      date_to: sp.get('date_to') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { table_name, record_id, user_id, action, date_from, date_to, page, per_page } = parsed.data;

    const supabase = await createClient();
    let query = supabase
      .from('audit_logs')
      .select(
        'id, table_name, record_id, action, old_values, new_values, created_at, user:user_profiles!audit_logs_user_id_fkey(id, full_name, role)',
        { count: 'exact' },
      );

    if (table_name && table_name !== 'all') query = query.eq('table_name', table_name);
    if (record_id) query = query.eq('record_id', record_id);
    if (user_id) query = query.eq('user_id', user_id);
    if (action) query = query.eq('action', action);
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', `${date_to}T23:59:59.999Z`);

    const from = (page - 1) * per_page;
    query = query.order('created_at', { ascending: false }).range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    return apiSuccess({ data: data ?? [], meta: { total: count ?? 0, page, per_page } });
  } catch (err) {
    return handleApiError(err);
  }
}
