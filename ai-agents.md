---
description: Правила работы с Anthropic AI — промпты, токены, безопасность
globs: ["lib/ai/**", "app/api/ai/**", "scripts/generate-weekly-report.ts"]
---

# AI Rules

## Модель и параметры

```typescript
// Всегда claude-sonnet-4-5, никакой другой
model: 'claude-sonnet-4-5'

// max_tokens по типу инсайта
// anomaly:        800
// forecast:       400
// recommendation: 600
// weekly_report:  2000
```

## Экономия токенов — проверяй правила ДО вызова AI

```typescript
// Аномалии: сначала ANOMALY_RULES, потом AI
const flagged = hasAnyFlag(managerData);
if (!flagged) return; // не тратим токены

// Прогнозы: математика без AI
const forecastData = calcForecast(monthData);
// AI только добавляет текстовую интерпретацию (~300 токен)
```

## Парсинг ответа AI — всегда safeParse

```typescript
const raw = message.content[0].type === 'text' ? message.content[0].text : '';
const cleaned = raw.replace(/```json|```/g, '').trim();

try {
  const result = JSON.parse(cleaned);
  // использовать result
} catch {
  await logError({ source: 'cron_ai', severity: 'error',
    error_code: 'AI_PARSE_ERROR', message: 'Failed to parse AI response',
    context: { raw } });
  return; // не падаем, просто пропускаем
}
```

## Идемпотентность — проверяй дублирование

```typescript
// Еженедельный отчёт — только один за неделю
const { data: existing } = await supabase
  .from('ai_insights')
  .select('id')
  .eq('insight_type', 'weekly_report')
  .gte('period_start', weekStart)
  .single();
if (existing) return;
```

## Логируй tokens_used — всегда

```typescript
await supabase.from('ai_insights').insert({
  // ...
  tokens_used: message.usage.input_tokens + message.usage.output_tokens,
});
```

## On-demand rate limit — проверяй перед генерацией

```typescript
const { count } = await supabase
  .from('ai_insights')
  .select('*', { count: 'exact', head: true })
  .eq('triggered_by', userId)
  .gte('created_at', new Date(Date.now() - 2*60*60*1000).toISOString());
if ((count ?? 0) > 0)
  return errorResponse(429, 'AI_RATE_LIMIT', 'Доступен через 2 часа');
```

## Промпты — только JSON-ответы от модели

Все промпты заканчиваются явной инструкцией:
`"Ответь ТОЛЬКО JSON без markdown-обёртки и пояснений."`

## ANTHROPIC_API_KEY — только сервер

- Vercel: в env variables (не NEXT_PUBLIC_)
- Beget VPS: в .env для cron-скриптов
- Никогда в браузерном коде
- Никогда в CLAUDE.md или коде репозитория
