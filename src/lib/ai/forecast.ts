/**
 * Прогноз выполнения месячного плана найма (SPEC §5.10.2). Чистая математика.
 */
import { workdaysBetween } from '@/lib/api-helpers';

export interface ForecastResult {
  hires_fact: number;
  hires_plan: number;
  forecast_hires: number;
  forecast_pct: number;
  days_left: number;
  pace_per_day: number;
}

/** Текущая дата в YYYY-MM-DD. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function calcForecast(params: {
  hiresFact: number;
  hiresPlan: number;
  monthStart: string; // YYYY-MM-DD (1-е число месяца)
  monthEnd: string; // YYYY-MM-DD (последнее число месяца)
}): ForecastResult {
  const { hiresFact, hiresPlan, monthStart, monthEnd } = params;

  const workdaysTotal = workdaysBetween(monthStart, monthEnd);
  const workdaysPassed = workdaysBetween(monthStart, todayStr());
  const workdaysLeft = Math.max(workdaysTotal - workdaysPassed, 0);

  const pace = workdaysPassed > 0 ? hiresFact / workdaysPassed : 0;
  const forecastHires = hiresFact + Math.round(pace * workdaysLeft);
  const forecastPct = hiresPlan > 0 ? Math.round((forecastHires / hiresPlan) * 100) : 0;

  return {
    hires_fact: hiresFact,
    hires_plan: hiresPlan,
    forecast_hires: forecastHires,
    forecast_pct: forecastPct,
    days_left: workdaysLeft,
    pace_per_day: pace,
  };
}
