import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
    include: ['src/tests/**/*.test.{ts,tsx}'],
    exclude: ['src/tests/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/lib/nav.ts', 'src/lib/api-helpers.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
