# Карта административных доступов

## Системы

| Система | Production-идентификатор | Что требуется администратору | Где проверять |
|---|---|---|---|
| Git / рабочий репозиторий | `C:\Users\admin\Desktop\HR` | доступ к remote и рабочей ветке | `git remote -v`, `git status` |
| Next.js сайта подбора | `C:\Users\admin\Desktop\id-tools\podborhhsource\podbor-sso` | доступ к исходнику и Vercel-проекту | локальный `README.md`, `.vercel/project.json` при наличии |
| Vercel | проект `podbor-hh`, домен `hr.tools.rlevelai.ru` | роль Developer или выше в команде проекта | Vercel Dashboard, `npx vercel whoami`, `npx vercel inspect` |
| Supabase | project ref `twfmfmkqfhclzvdogvix` | роль Developer/Owner и авторизованный CLI | Supabase Dashboard, Edge Functions, Database, Storage |
| Supabase Storage | bucket `candidates` | просмотр объектов и политик; запись только для обслуживающих функций | Dashboard → Storage |
| Telegram | Edge Function `tg-hr-bot` | доступ к настройкам проекта и белому списку пользователей | `podbor_settings`, `podbor_bot_users` |
| Borboza | `orders.borboza.com` | личная разрешённая сессия отчётов | скиллы `borboza-autologin`, `borboza-collector` |
| HH.ru | API/CSV аналитики подбора | разрешённый OAuth/кабинет работодателя | интеграции проекта и `/sync` |
| Yamaguchi ID | приложение `podbor_hh` | админ доступа приложения | настройки `@yamaguchi/auth` вне этого репозитория |

## Реестр секретов без значений

| Имя | Где должно храниться | Для чего | Правило изменения |
|---|---|---|---|
| `PODBOR_CODE` | Vercel Environment Variables проекта `podbor-hh` | серверный вызов Edge Functions из Next.js | после изменения нужен новый Vercel deployment |
| `HH_UI_CODE` | Supabase Edge Function secrets | проверка внутренних вызовов HR-функций | менять синхронно с `PODBOR_CODE` |
| `SUPABASE_SERVICE_ROLE_KEY` | управляемые secrets Edge Functions | привилегированный серверный доступ | никогда не передавать в браузер |
| `telegram_bot_token` | `public.podbor_settings` | Telegram Bot API | читать и менять только защищённым admin-контекстом |
| `tg_webhook_secret` | `public.podbor_settings` | проверка Telegram webhook | после ротации перерегистрировать webhook |
| `bot_invite_code` | `public.podbor_settings` | самостоятельное добавление HR в бота | передавать пользователю только приватно |
| локальные env | `.env.local` или секретное хранилище, файлы игнорируются git | локальная сборка и smoke-test | не копировать в документацию |

Наличие секрета проверять по имени и длине либо фактом успешного запроса. Не печатать значение.

## Проверка доступа без изменения данных

```powershell
git status --short
npx vercel whoami
npx vercel inspect https://hr.tools.rlevelai.ru
supabase --version
supabase functions list --project-ref twfmfmkqfhclzvdogvix
curl.exe --max-time 20 -L -sS -o NUL -w "%{http_code} %{content_type}\n" https://hr.tools.rlevelai.ru/present
curl.exe --max-time 20 -L -sS -o NUL -w "%{http_code} %{content_type}\n" https://hr.tools.rlevelai.ru/rookies
```

Если `supabase` не находится в `PATH`, использовать установленный `supabase.cmd`, но не сохранять персональный access token в команде или файле.

## Выдача доступа новому администратору

1. Выдать минимальную нужную роль отдельно в Git, Vercel и Supabase.
2. Убедиться, что администратор видит проект `podbor-hh` и Supabase `twfmfmkqfhclzvdogvix`.
3. Не передавать service-role key и коды через общий чат.
4. Для Telegram сначала зарегистрировать обычного пользователя по [telegram-users.md](../../.agents/skills/podbor-hr-support/references/telegram-users.md).
5. `is_admin=true` выдавать только по отдельному решению владельца и проверять конкретный Telegram ID.
6. Провести read-only smoke-test из предыдущего раздела.

## Отзыв доступа

1. Удалить пользователя из Git/Vercel/Supabase команд или понизить роль.
2. Деактивировать Telegram-пользователя через `is_active=false`, не удаляя историю.
3. При риске компрометации ротировать соответствующий секрет и проверить зависимые сервисы.
4. Зафиксировать дату, причину и ответственного без записи секретных значений.
