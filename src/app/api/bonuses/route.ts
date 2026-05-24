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
import { bonusesQuerySchema } from '@/lib/validations';

/**
 * GET /api/bonuses — список бонусов за период (по умолчанию текущий месяц).
 *
 * SPEC §5.3 / §5.6: бонус считается на лету как тариф из bonus_rates
 * (fuzzy-match с vacancies.title по pg_trgm threshold 0.4).
 * Источник истины — RPC compute_manager_bonuses (SECURITY DEFINER), берёт
 * vacancies WHERE status='closed' AND closed_at ∈ period.
 *
 * RLS-инвариант:
 *  - manager → форсим p_manager_id = auth.uid() (видит только свои);
 *  - head/admin → опциональный manager_id в query.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    const sp = request.nextUrl.searchParams;
    const parsed = bonusesQuerySchema.safeParse({
      manager_id: sp.get('manager_id') ?? undefined,
      year: sp.get('year') ?? undefined,
      month: sp.get('month') ?? undefined,
    });
    if (!parsed.success) {
      return apiError('VALIDATION_ERROR', parsed.error.issues[0].message, 422);
    }
    const { manager_id, year, month } = parsed.data;

    if (manager_id) requireRole(user, ['head', 'admin']);

    // Эффективный manager filter: manager-роль всегда видит только себя.
    const effectiveManagerId = manager_id ?? (user.role === 'manager' ? user.id : null);

    const { from, to } = monthRange(year, month);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('compute_manager_bonuses', {
      p_from: from,
      p_to: to,
      p_manager_id: effectiveManagerId,
    });
    if (error) throw new ApiError(500, 'DB_ERROR', error.message);

    type RpcRow = {
      vacancy_id: string;
      manager_id: string | null;
      manager_name: string | null;
      manager_is_active: boolean | null;
      vacancy_title: string | null;
      closed_at: string | null;
      rate_id: string | null;
      rate_position_name: string | null;
      amount_kopecks: number | null;
      similarity_score: number | null;
    };

    const rows = (data as RpcRow[] | null) ?? [];
    const list = rows.map((r) => ({
      vacancy_id: r.vacancy_id,
      manager: r.manager_id
        ? { id: r.manager_id, full_name: r.manager_name ?? '—', is_active: r.manager_is_active ?? true }
        : null,
      vacancy: { id: r.vacancy_id, title: r.vacancy_title ?? '—' },
      closed_at: r.closed_at,
      rate_position_name: r.rate_position_name,
      amount_kopecks: r.amount_kopecks,
      amount_display: r.amount_kopecks != null ? formatKopecks(r.amount_kopecks) : null,
    }));

    const totalAmountKopecks = rows.reduce((s, r) => s + (r.amount_kopecks ?? 0), 0);

    return apiSuccess({
      data: list,
      total_amount_kopecks: totalAmountKopecks,
      total_amount_display: formatKopecks(totalAmountKopecks),
      meta: { from, to, total: list.length },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** Копейки → «50 000 ₽». */
function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')} ₽`;
}

/** Диапазон дат: при year+month — этот месяц; при year — весь год;
 *  без аргументов — текущий месяц. */
function monthRange(year?: number, month?: number): { from: string; to: string } {
  if (year && month) {
    const last = new Date(year, month, 0).getDate();
    return {
      from: `${year}-${String(month).padStart(2, '0')}-01`,
      to: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    };
  }
  if (year) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  };
}
