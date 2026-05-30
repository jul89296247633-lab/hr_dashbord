/**
 * Логирование ошибок в таблицу error_logs для cron-скриптов.
 * Дублирует src/lib/logger.ts, но для CommonJS-среды (scripts/).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = { from: (table: string) => any };

interface LogErrorOptions {
  db: AnyDb;
  source: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  error_code: string;
  message: string;
  context?: Record<string, unknown>;
}

export async function logError(opts: LogErrorOptions): Promise<void> {
  try {
    await opts.db.from('error_logs').insert({
      source: opts.source,
      severity: opts.severity,
      error_code: opts.error_code,
      message: opts.message,
      context: opts.context ?? null,
    });
  } catch {
    // Не прерываем скрипт из-за ошибки логирования
    console.error(`[logger] Не удалось записать error_log: ${opts.message}`);
  }
}
