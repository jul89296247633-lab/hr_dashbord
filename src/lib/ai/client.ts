import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@/lib/api-helpers';

/**
 * Клиент Anthropic Messages API. ТОЛЬКО серверный код — ключ не попадает в браузер.
 * Модель проекта: claude-sonnet-4-5 (CLAUDE.md / SPEC §5.10).
 */
export const AI_MODEL = 'claude-sonnet-4-5';

export function createAiClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** Результат генерации инсайта: распарсенный JSON ответа модели. */
export interface AiInsightResult {
  title: string;
  body_md: string;
  severity?: 'low' | 'medium' | 'high';
}

/**
 * Запрашивает модель и парсит JSON-ответ (срезает markdown-обёртку ```).
 * Возвращает результат + потраченные токены.
 *
 * Ошибки парсинга/схемы → `ApiError(502, 'AI_PARSE_ERROR')`. Используем 502:
 * это сбой апстрима (модель вернула битый ответ), а не 500 внутренний.
 * handleApiError() сам смаппит в HTTP-ответ.
 */
export async function generateInsight(
  prompt: string,
  maxTokens = 1000,
): Promise<{ result: AiInsightResult; tokensUsed: number }> {
  const client = createAiClient();
  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  const raw = block && block.type === 'text' ? block.text : '';
  const cleaned = raw.replace(/```json|```/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Логируем превью, не весь ответ, чтобы не загромождать логи.
    console.error('[ai] JSON.parse failed; first 200 chars:', cleaned.slice(0, 200));
    throw new ApiError(502, 'AI_PARSE_ERROR', 'Модель вернула невалидный JSON. Повторите запрос.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).title !== 'string' ||
    typeof (parsed as Record<string, unknown>).body_md !== 'string'
  ) {
    throw new ApiError(502, 'AI_PARSE_ERROR', 'AI вернул некорректный формат ответа');
  }
  const result = parsed as AiInsightResult;

  return {
    result,
    tokensUsed: message.usage.input_tokens + message.usage.output_tokens,
  };
}
