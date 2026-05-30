import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Отдельный конфиг для интеграционных тестов (RLS + триггеры).
 *
 * Главный vitest.config.ts намеренно ИСКЛЮЧАЕТ src/tests/integration/** и
 * запускается в jsdom с DOM-setup (@testing-library/jest-dom) — это ломает
 * node-тесты, бьющие в реальный Supabase. Поэтому здесь:
 *   • environment: 'node' (без jsdom)
 *   • БЕЗ setupFiles (DOM-матчеры не нужны)
 *   • include = только src/tests/integration/**
 *
 * ⚠️  ТРЕБУЕТ ЗАПУЩЕННОГО ЛОКАЛЬНОГО STACK'А (Docker):
 *     supabase start
 *     # env: SUPABASE_LOCAL_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY
 *     npm run test:integration
 *
 * Без ключей сьют сам себя пропускает (describe.skip), а не падает.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/tests/integration/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
