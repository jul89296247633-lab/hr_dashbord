import type { NextConfig } from 'next';

// Security headers (SEC-006). CSP — ENFORCED (после периода Report-Only на проде
// без нарушений). Браузер блокирует ресурсы вне политики. Политика разрешает то,
// что реально нужно фронту (Next inline-bootstrap/hydration, Tailwind v4 + Radix
// inline-стили, Supabase REST+WS). Дальнейшее ужесточение (nonce вместо
// 'unsafe-inline'/'unsafe-eval' для script-src) — отдельной задачей.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js inline bootstrap + hydration
      "style-src 'self' 'unsafe-inline'",                // Tailwind v4 + Radix inline-стили
      "img-src 'self' data: blob: https:",               // next/image, base64, аватары
      "font-src 'self' data:",                           // шрифты self-hosted (внешних нет)
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co", // REST + realtime WS
      "frame-ancestors 'none'",                          // анти-clickjacking (дубль X-Frame-Options)
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Фиксируем корень трассировки на каталоге проекта: в системе есть
  // родительский package-lock.json, иначе Next выбирает неверный workspace root.
  outputFileTracingRoot: __dirname,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
