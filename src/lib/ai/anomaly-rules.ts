/**
 * Правила выявления аномалий активности менеджера (SPEC §5.10.1).
 * Применяются как быстрый предфильтр ДО вызова AI — экономим токены.
 */
export const ANOMALY_RULES = {
  calls_pct_drop: { threshold: 70, severity: 'high', label: 'Резкое падение звонков' },
  calls_pct_warn: { threshold: 80, severity: 'medium', label: 'Звонки ниже нормы' },
  iv_drop_points: { threshold: 10, severity: 'high', label: 'Падение ИВ более 10 пп' },
  iv_low: { threshold: 70, severity: 'medium', label: 'ИВ ниже 70%' },
  zero_calls_days: { threshold: 2, severity: 'high', label: 'Более 2 дней без звонков' },
  interviews_pct: { threshold: 70, severity: 'medium', label: 'Собеседования ниже 70% плана' },
} as const;
