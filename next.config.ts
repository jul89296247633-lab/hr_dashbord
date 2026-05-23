import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Фиксируем корень трассировки на каталоге проекта: в системе есть
  // родительский package-lock.json, иначе Next выбирает неверный workspace root.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
