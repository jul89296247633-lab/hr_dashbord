// Корневой маршрут. Middleware (src/middleware.ts) перенаправляет авторизованного
// пользователя на /cabinet (manager) или /dashboard (head/executive/admin),
// а неавторизованного — на /login. Эта страница — заглушка для Блока UI.
export default function HomePage() {
  return null;
}
