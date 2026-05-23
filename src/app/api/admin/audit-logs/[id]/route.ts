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
import { uuidSchema } from '@/lib/validations';

/**
 * GET /api/admin/audit-logs/[id] — одна запись audit trail (только admin).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['admin']);

    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return apiError('AUDIT_LOG_NOT_FOUND', 'Запись журнала не найдена', 404);
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('audit_logs')
      .select(
        'id, table_name, record_id, action, old_values, new_values, ip_address, user_agent, created_at, user:user_profiles!audit_logs_user_id_fkey(id, full_name, role)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);
    if (!data) return apiError('AUDIT_LOG_NOT_FOUND', 'Запись журнала не найдена', 404);

    return apiSuccess({ data });
  } catch (err) {
    return handleApiError(err);
  }
}
