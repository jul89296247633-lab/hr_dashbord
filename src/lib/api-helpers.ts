import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AuthUser, Role, Period, ManagerStatus } from '@/types';

/** Cookie с id активной impersonation-сессии (= impersonation_logs.id). */
export const IMPERSONATE_COOKIE = 'impersonate_sid';
/** TTL impersonation-сессии (server-authoritative). */
const IMPERSONATE_TTL_MS = 60 * 60 * 1000; // 1 час

/** Контекст авторизации: эффективная identity + реальный пользователь + флаг impersonation. */
export interface AuthContext {
  user: AuthUser; // эффективная identity (менеджер при impersonation)
  realUser: AuthUser; // всегда реальный вошедший (admin/head)
  impersonating: boolean;
}

/**
 * Общие хелперы API-слоя: авторизация, проверка ролей, единый формат ответов.
 * Формат ответов (SPEC Блок 3 / api.md):
 *   успех  → { ...data }            (apiSuccess)
 *   ошибка → { error: { code, message } }
 */

/** Типизированная ошибка API. Ловится в роутах и маппится в HTTP-ответ. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Ответ-ошибка: { error: { code, message } } со статусом. */
export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Успешный ответ. Тело передаётся как есть (например { data } или { data, meta }). */
export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Возвращает авторизованного пользователя с профилем.
 * @throws ApiError 401 UNAUTHORIZED — нет валидной сессии / профиля.
 * @throws ApiError 403 ACCOUNT_DISABLED — профиль деактивирован (is_active=false).
 */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createClient();

  // getUser() (не getSession) — проверяет токен на сервере Supabase.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Требуется авторизация');
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, role, full_name, is_active')
    .eq('id', user.id)
    .single();

  if (!profile) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Профиль пользователя не найден');
  }

  if (!profile.is_active) {
    throw new ApiError(403, 'ACCOUNT_DISABLED', 'Аккаунт деактивирован');
  }

  const realUser: AuthUser = {
    id: profile.id as string,
    role: profile.role as Role,
    full_name: profile.full_name as string,
  };

  // ── Impersonation overlay (SEC: FEATURE_SPEC_impersonation.md) ──────────────
  // Активен ТОЛЬКО для admin/head И при валидной незакрытой непросроченной записи
  // в impersonation_logs. Cookie сам прав не даёт — авторитет на сервере.
  if (realUser.role === 'admin' || realUser.role === 'head') {
    const sid = (await cookies()).get(IMPERSONATE_COOKIE)?.value;
    if (sid) {
      const overlay = await resolveImpersonation(sid, realUser);
      if (overlay) {
        return { user: overlay, realUser, impersonating: true };
      }
    }
  }

  return { user: realUser, realUser, impersonating: false };
}

/**
 * Разрешает overlay-identity по id сессии. Возвращает менеджера, только если:
 * запись принадлежит этому impersonator'у, не закрыта, не просрочена (TTL),
 * а цель — активный пользователь с role='manager'. Иначе null.
 */
async function resolveImpersonation(sid: string, realUser: AuthUser): Promise<AuthUser | null> {
  const db = createAdminClient();
  const { data: sess } = await db
    .from('impersonation_logs')
    .select('impersonator_id, target_manager_id, started_at, ended_at')
    .eq('id', sid)
    .maybeSingle();

  if (
    !sess ||
    sess.impersonator_id !== realUser.id ||
    sess.ended_at !== null ||
    Date.now() - new Date(sess.started_at).getTime() >= IMPERSONATE_TTL_MS
  ) {
    return null;
  }

  const { data: target } = await db
    .from('user_profiles')
    .select('id, role, full_name, is_active')
    .eq('id', sess.target_manager_id)
    .single();

  if (!target || target.role !== 'manager' || !target.is_active) {
    return null;
  }

  return {
    id: target.id as string,
    role: target.role as Role,
    full_name: target.full_name as string,
  };
}

/**
 * Возвращает эффективную identity (менеджера при активной impersonation).
 * Обёртка над getAuthContext — обратносовместима со всеми существующими роутами.
 */
export async function getAuthUser(): Promise<AuthUser> {
  return (await getAuthContext()).user;
}

/**
 * Проверяет, что роль пользователя входит в список разрешённых.
 * @throws ApiError 403 FORBIDDEN — недостаточно прав.
 */
export function requireRole(user: AuthUser, roles: Role[]): void {
  if (!roles.includes(user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав');
  }
}

/**
 * Единый обработчик ошибок для catch-блоков роутов.
 * ApiError → соответствующий статус/код; прочее → 500 INTERNAL_ERROR.
 * 422/404 не считаются сбоями (штатная работа, не логируем — CLAUDE.md).
 */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return apiError(err.code, err.message, err.status);
  }

  // Непредвиденная ошибка — единственный разрешённый канал логирования на сервере.
  console.error('[api] Unhandled error:', err);
  return apiError('INTERNAL_ERROR', 'Внутренняя ошибка сервера', 500);
}

// ── KPI / период ────────────────────────────────────────────────────────────

/** Локальная дата в формате YYYY-MM-DD. */
function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Границы периода для фильтрации по дате (YYYY-MM-DD), включительно.
 * Единый источник диапазонов для всех dashboard-роутов (не дублировать).
 *   today → [сегодня, сегодня]
 *   week  → [понедельник текущей недели, сегодня]
 *   month → [1-е число текущего месяца, сегодня]
 *   all   → [null, null] (без ограничений)
 */
export function getPeriodRange(period: Period): { from: string | null; to: string | null } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (period === 'all') {
    return { from: null, to: null };
  }
  if (period === 'today') {
    return { from: toDateString(today), to: toDateString(today) };
  }
  if (period === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateString(first), to: toDateString(today) };
  }
  // week: понедельник текущей недели (getDay: 0=вс..6=сб → смещение к Пн)
  const monday = new Date(today);
  const offset = (today.getDay() + 6) % 7;
  monday.setDate(today.getDate() - offset);
  return { from: toDateString(monday), to: toDateString(today) };
}

/** Кол-во рабочих дней (Пн–Пт), включительно, в диапазоне дат YYYY-MM-DD. */
export function workdaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  let count = 0;
  for (const d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/** % выполнения KPI, округление до 0.1. plan=0 → 100 если есть факт, иначе 0. */
export function kpiPct(fact: number, plan: number): number {
  if (plan > 0) return Math.round((fact / plan) * 1000) / 10;
  return fact > 0 ? 100 : 0;
}

/**
 * Статус менеджера по среднему % трёх KPI (SPEC §5.3).
 * Метки по ТЗ: ≥90 on_track, 70–89 lagging, <70 critical.
 */
export function calcManagerStatus(
  callsPct: number,
  interviewsPct: number,
  hiresPct: number,
): ManagerStatus {
  const avg = (callsPct + interviewsPct + hiresPct) / 3;
  if (avg >= 90) return 'on_track';
  if (avg >= 70) return 'lagging';
  return 'critical';
}

/** Статус по одному % (для пометки отдельной KPI-метрики). */
export function statusFromPct(pct: number): ManagerStatus {
  if (pct >= 90) return 'on_track';
  if (pct >= 70) return 'lagging';
  return 'critical';
}

/**
 * Масштабирует месячный план найма под выбранный период (today/week/month).
 * Закрывает баг ревью 4.5 #3: сравнивать факт за день/неделю с месячным планом
 * нечестно (все становятся `critical`). Делим план пропорционально рабочим дням
 * периода относительно рабочих дней месяца, в котором заканчивается период.
 *
 * Edge: если в месяце нет рабочих дней (теоретически) → возвращаем monthlyPlan.
 */
export function scaledHiresPlan(
  monthlyPlan: number,
  from: string,
  to: string,
): number {
  const refDate = new Date(`${to}T00:00:00`);
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const workdaysPeriod = workdaysBetween(from, to);
  const workdaysMonth = workdaysBetween(monthStart, monthEnd);
  if (workdaysMonth <= 0) return monthlyPlan;
  return Math.max(Math.round((monthlyPlan * workdaysPeriod) / workdaysMonth), 0);
}

/** Полный текущий календарный месяц [1-е … последний день].
 *  Используется для метрики «Выведено» / закрытые вакансии: SPEC §5.3 фиксирует
 *  её как помесячную, не зависящую от селектора периода страницы. */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** «YYYY-MM» → [1-е, последний день]. Невалидный формат → текущий месяц.
 *  Используется в /api/dashboard/* для query-param `month` (MonthPicker). */
export function monthRangeFromYM(ym: string | null | undefined): { from: string; to: string } {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return currentMonthRange();
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (m < 1 || m > 12) return currentMonthRange();
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, '0')}`,
  };
}
