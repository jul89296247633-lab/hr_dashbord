/**
 * Telegram Bot API — алерты admin'у из cron-скриптов.
 * Используется только в scripts/, не в Next.js приложении.
 * Rate limit HH не применяется — это наш бот.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID   = process.env.TELEGRAM_ADMIN_CHAT_ID ?? '';

/** Отправляет текстовое сообщение. Не бросает при сбое — только пишет в stderr. */
export async function sendAlert(message: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN или TELEGRAM_ADMIN_CHAT_ID не настроен');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[telegram] HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[telegram] Ошибка отправки:', err instanceof Error ? err.message : err);
  }
}

/** Форматирует сообщение с эмодзи-маркером. */
export function fmt(emoji: string, title: string, details?: string): string {
  const lines = [`${emoji} <b>${title}</b>`];
  if (details) lines.push(details);
  return lines.join('\n');
}
