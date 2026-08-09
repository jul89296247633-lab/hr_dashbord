> ⚠️ **УСТАРЕЛ — заменён `SPEC_podkluchenie_proekta_Yamaguchi_ID.md`.**
> Документ сохранён как исторический контекст Фазы 2 (SSO). Не использовать как источник истины:
> актуальные решения по подключению к Yamaguchi ID живут в новой спеке.

# FD-1: OIDC SSO через borboza — HR Control Tower

> **Проект:** Yamaguchi HR Control Tower
> **Supabase project_id:** twfmfmkqfhclzvdogvix (НЕ posting/Четвёртый Форс)
> **Дата:** 2026-06-03
> **Статус:** FD-1 готов, ждёт данных провайдера → FS-2 → Build (отдельная сессия)
> **Спека 6** (после PR feature → main)

---

## Что это

HR логинится в дашборд через корпоративный OIDC-портал passport.borboza.com.
Дашборд — OIDC-клиент (не провайдер). Своя реализация флоу (по образцу
существующего HH OAuth), НЕ через Supabase Auth providers.

## Зафиксированные решения

1. **Вход только через borboza** — email/пароль убираем для обычных пользователей
2. **Связь по email** — OIDC-callback находит/создаёт auth.users по email → Supabase-сессия
3. **Auto-provision** — новый borboza-email создаётся автоматически, роль `manager`, is_active=true
4. **Повышение роли** — только вручную через /admin/users (manager → head/admin)
5. **Контроль доступа** — на стороне borboza (доступ к проекту выдаётся адресно, только HR)
   → риск auto-provision закрыт: посторонние не имеют borboza-доступа к проекту

## Флоу

- `/api/auth/oidc/start` — authorize-URL с client_id, redirect_uri, scope, state (CSRF-nonce)
- borboza → редирект на `/api/auth/oidc/callback` с кодом
- callback: обмен кода на токены (client_secret из env), достать email+имя из userinfo
- найти auth.users по email → если нет, создать (admin API) + профиль user_profiles (role=manager)
- выдать Supabase-сессию → редирект в дашборд

## Что НЕ входит

- Управление borboza-доступами (на стороне портала)
- Синхронизация ролей из borboza (роли живут в дашборде)

## ОБЯЗАТЕЛЬНО получить до FS-2

1. **Точный redirect_uri** — посимвольно. Стандарт:
   https://hr-dashbord.vercel.app/api/auth/oidc/callback
   http://localhost:3000/api/auth/oidc/callback
   (была опечатка "oidc.callback" с точкой — уточнить!)
   Должен ТОЧНО совпасть с кодом, иначе флоу упадёт (как было с HH).

2. **Аварийный admin-вход** — РЕШЕНИЕ НУЖНО. Если убрать email/пароль совсем
   и borboza ляжет — никто не зайдёт, включая admin. Рекомендация: оставить
   email/пароль-вход хотя бы для одного admin (владелец). НЕ решено окончательно.

3. **Данные провайдера** (НЕ секрет):
   - client_id
   - есть ли https://passport.borboza.com/oidc/.well-known/openid-configuration
   - scopes (обычно openid profile email)

4. **client_secret** → ТОЛЬКО в Vercel env под OIDC_CLIENT_SECRET. Никогда в чат/код/репо.

## Схема БД — что добавить (в FS-2)

user_profiles сейчас НЕТ полей oidc_sub, auth_provider. Решить в FS-2:
- нужно ли хранить oidc_sub (стабильный идентификатор от borboza) для связи,
  или достаточно email (email может меняться — oidc_sub надёжнее)
- auth_provider флаг (borboza/email) если оставляем аварийный вход

## Риски / на что смотреть

- Удаление email/пароль-входа = риск полной блокировки при сбое borboza → аварийный admin
- Связь по email хрупка если email меняется → рассмотреть oidc_sub как первичный ключ связи
- admin-доступ к auth.users (создание пользователей) — service_role, строго серверно
- state-параметр обязателен (CSRF) — серверный nonce, не просто значение
