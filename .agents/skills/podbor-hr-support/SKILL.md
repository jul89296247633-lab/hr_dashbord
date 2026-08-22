---
name: podbor-hr-support
description: "Поддержка HR-подбора YAMAGUCHI: восстановление фото, описаний и маршрутов /present и /rookies, диагностика связки Vercel + Supabase Storage/Edge Functions, а также добавление, активация и проверка пользователей Telegram-бота tg-hr-bot. Использовать при 404, пустых карточках, инициалах вместо фото, пропавших описаниях, ошибках загрузки Supabase Storage, молчащем боте или запросе на доступ нового HR в Telegram."
---

# Поддержка HR-подбора

Работать с production-системой подбора без потери карточек, фото и истории. Сначала подтверждать причину чтением кода, ответов API и статуса деплоя; только затем менять минимальный слой.

## Контекст системы

- Сайт: `https://hr.tools.rlevelai.ru`
- Vercel-проект: `podbor-hh`
- Supabase-проект: `twfmfmkqfhclzvdogvix`
- Next.js-исходник: `C:\Users\admin\Desktop\id-tools\podborhhsource\podbor-sso`
- Локальные Edge Functions: `C:\Users\admin\Desktop\HR\supabase\functions`
- Storage bucket: `candidates`
- Карточки: `public.podbor_people`
- Пользователи бота: `public.podbor_bot_users`
- Настройки бота: `public.podbor_settings`

Поток данных:

`Telegram -> tg-hr-bot -> candidates/inbox -> podbor_people -> hr-present -> hr-ui-present -> /present -> /api/photo -> browser`

## Выбор процедуры

- Перед корректировкой production-доступов, деплоем или восстановлением прочитать [../../../docs/admin/README.md](../../../docs/admin/README.md).
- При пропаже фото, описаний, дат, 404 или пустом экране обязательно прочитать [references/photo-presentation-incident.md](references/photo-presentation-incident.md) целиком.
- При добавлении, разблокировке или переименовании пользователя Telegram обязательно прочитать [references/telegram-users.md](references/telegram-users.md) целиком.
- Если затронуты оба сценария, выполнить сначала восстановление экрана, затем регистрацию пользователя.

## Жёсткие правила

1. Не запускать `supabase db push`, `migration repair`, массовый `update`, `archive` или удаление карточек для исправления отображения.
2. Не считать отсутствие изображения потерей файла, пока не проверены `photo_path`, Storage и фактический HTTP-ответ.
3. Не деплоить Next.js-каталог, пока build-список не содержит `/present`, `/rookies` и `/api/photo`.
4. Не выводить токены, service-role key, `PODBOR_CODE`, `HH_UI_CODE`, `bot_invite_code` и `tg_webhook_secret` в чат или логи.
5. Не делать нового пользователя администратором без отдельного явного решения владельца системы.
6. Сохранять существующие пользовательские изменения в dirty worktree; не выполнять reset/checkout.
7. После каждого изменения проверять production, а не только локальную сборку.

## Критерий завершения

Считать восстановление завершённым только когда:

- `/present` и `/rookies` существуют в production;
- HTML Edge Functions не содержит сообщения об ошибке;
- карточки презентации имеют `photo_url`, `description` и даты там, где они заполнены;
- тест `/api/photo?path=...` возвращает `200` и `image/*`;
- в Vercel нет новых 5xx;
- пользователь Telegram проходит `/кто` и может создать тестовый черновик без записи лишней карточки.
