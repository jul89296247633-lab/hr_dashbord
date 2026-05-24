import { ANOMALY_RULES } from './anomaly-rules';
import type { ForecastResult } from './forecast';

/**
 * Промпты AI-анализа (SPEC §5.10). Все промпты требуют от модели строго JSON:
 *   { "title": string, "body_md": string (Markdown), "severity"?: "low"|"medium"|"high" }
 * Это даёт единый разбор ответа во всех типах инсайтов.
 */

const JSON_CONTRACT = `ФОРМАТ ОТВЕТА — только валидный JSON без markdown-обёртки:
{ "title": "краткий заголовок до 200 символов", "body_md": "развёрнутый анализ в Markdown", "severity": "low|medium|high" }`;

export interface ManagerWeekData {
  fullName: string;
  periodStart: string;
  periodEnd: string;
  callsFact: number;
  callsPlan: number;
  callsPct: number;
  prevCallsPct: number | null;
  interviewsFact: number;
  interviewsPlan: number;
  interviewsPct: number;
  hiresFact: number;
  hiresPlan: number;
  politenessIndex: number | null;
  zeroCallsDays: number;
}

export function buildAnomalyPrompt(d: ManagerWeekData): string {
  return `Ты — HR-аналитик. Проанализируй данные рекрутёра за неделю и выяви аномалии.

ДАННЫЕ РЕКРУТЁРА:
Имя: ${d.fullName}
Период: ${d.periodStart} — ${d.periodEnd}

KPI за неделю:
- Звонки: ${d.callsFact} / ${d.callsPlan} (${d.callsPct}%)
- Звонки предыдущей недели: ${d.prevCallsPct ?? 'нет данных'}%
- Собеседования: ${d.interviewsFact} / ${d.interviewsPlan} (${d.interviewsPct}%)
- Закрыто вакансий: ${d.hiresFact} / ${d.hiresPlan}
- Индекс вежливости: ${d.politenessIndex ?? 'нет данных'}
- Дней без звонков: ${d.zeroCallsDays}

ПРАВИЛА ФЛАГОВ: ${JSON.stringify(ANOMALY_RULES)}

ЗАДАЧА: определи аномалии, дай заголовок и анализ 150–300 слов + рекомендацию руководителю.
${JSON_CONTRACT}`;
}

export function buildForecastPrompt(fullName: string, f: ForecastResult): string {
  return `Ты — HR-аналитик. Рекрутёр ${fullName}. Факт: ${f.hires_fact}/${f.hires_plan} выводов. Прогноз на конец месяца: ${f.forecast_pct}%. Осталось ${f.days_left} рабочих дней. Темп: ${f.pace_per_day.toFixed(1)} вывода/день.

ЗАДАЧА: напиши 2–3 предложения — как идёт месяц и что нужно сделать.
${JSON_CONTRACT}`;
}

export interface VacancyFunnelData {
  title: string;
  responses: number;
  contactsOpened: number;
  invitationsSent: number;
  calls: number;
  daysOpen: number;
}

export function buildRecommendationPrompt(d: VacancyFunnelData): string {
  return `Ты — HR-аналитик. Проанализируй воронку вакансии и дай рекомендации по узким местам.

ВАКАНСИЯ: ${d.title} (открыта ${d.daysOpen} дн.)
Воронка: отклики ${d.responses} → открыто контактов ${d.contactsOpened} → приглашений ${d.invitationsSent} → звонков ${d.calls}

ЗАДАЧА: найди узкое место воронки и дай 2–3 конкретные рекомендации рекрутёру.
${JSON_CONTRACT}`;
}
