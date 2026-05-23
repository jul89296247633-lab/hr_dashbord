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
import { aiInsightsQuerySchema } from '@/lib/validations';

/**
 * GET /api/ai/insights — список AI-инсайтов (head, admin). DESC по created_at.
 * Фильтры: type, unread. meta.unread — общее число непрочитанных.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    requireRole(user, ['head', 'admin']);

    const sp = request.nextUrl.searchParams;
    const parsed = aiInsightsQuerySchema.safeParse({
      type: sp.get('type') ?? undefined,
      unread: sp.get('unread') ?? undefined,
      page: sp.get('page') ?? undefined,
      per_page: sp.get('per_page') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { type, unread, page, per_page } = parsed.data;

    const supabase = await createClient();

    let query = supabase
      .from('ai_insights')
      .select(
        'id, insight_type, severity, period_start, period_end, manager_id, vacancy_id, title, body_md, meta_json, is_read, tokens_used, created_at, manager:user_profiles!ai_insights_manager_id_fkey(id, full_name), vacancy:vacancies!ai_insights_vacancy_id_fkey(id, title)',
        { count: 'exact' },
      );
    if (type !== 'all') query = query.eq('insight_type', type);
    if (unread === true) query = query.eq('is_read', false);

    const from = (page - 1) * per_page;
    query = query.order('created_at', { ascending: false }).range(from, from + per_page - 1);

    const { data, count, error } = await query;
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    // Общее число непрочитанных (для бейджа).
    const { count: unreadCount, error: unreadError } = await supabase
      .from('ai_insights')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);
    if (unreadError) throw new ApiError(500, 'DB_ERROR', unreadError.message);

    return apiSuccess({
      data: data ?? [],
      meta: { total: count ?? 0, unread: unreadCount ?? 0, page, per_page },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
