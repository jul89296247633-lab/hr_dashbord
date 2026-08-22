# Пользователи Telegram-бота HR

## Источник истины

- Edge Function: `tg-hr-bot`
- Таблица доступа: `public.podbor_bot_users`
- Код приглашения: `public.podbor_settings`, ключ `bot_invite_code`
- Webhook secret: `public.podbor_settings`, ключ `tg_webhook_secret`
- Telegram token: `public.podbor_settings`, ключ `telegram_bot_token`

Не показывать значения настроек в чат, SQL-вывод или логи.

## Нормальное добавление пользователя

1. Попросить пользователя открыть личный чат с HR-ботом. В группах бот намеренно молчит.
2. Попросить отправить `/start` без кода. Бот вернёт Telegram ID и инструкцию.
3. Через защищённый доступ прочитать `bot_invite_code`:

```sql
select value
from public.podbor_settings
where key = 'bot_invite_code';
```

4. Передать код пользователю приватно. Пользователь отправляет:

```text
/start КОД
```

5. Бот сам делает upsert в `podbor_bot_users`:

- `telegram_id` — ID Telegram;
- `full_name` — `Фамилия Имя` из профиля либо заглушка;
- `username` — username Telegram;
- `is_active = true`;
- `is_admin = false`, кроме технического случая полностью пустой таблицы;
- `added_by = 'сам по коду приглашения'`.

6. Попросить пользователя задать подпись:

```text
/имя Фамилия Имя
```

7. Проверить:

```text
/кто
```

Бот должен вернуть точную подпись. Она обновляется в презентации и для старых карточек, потому что экран сопоставляет `podbor_people.author_tg` с живым справочником `podbor_bot_users`.

## Проверка в базе

Проверять только конкретный Telegram ID:

```sql
select telegram_id, full_name, username, is_admin, is_active, added_by
from public.podbor_bot_users
where telegram_id = <TELEGRAM_ID>;
```

Ожидать одну строку и `is_active = true`.

## Ручной fallback

Использовать только если регистрация `/start КОД` не сработала после проверки webhook и invite code.

```sql
insert into public.podbor_bot_users
  (telegram_id, full_name, username, is_admin, is_active, added_by)
values
  (<TELEGRAM_ID>, '<Фамилия Имя>', <USERNAME_OR_NULL>, false, true, 'добавлен администратором')
on conflict (telegram_id) do update
set full_name = excluded.full_name,
    username = excluded.username,
    is_active = true,
    added_by = excluded.added_by;
```

Не повышать `is_admin` существующему пользователю этим upsert.

## Блокировка и восстановление

Не удалять пользователя для обычной блокировки:

```sql
update public.podbor_bot_users
set is_active = false
where telegram_id = <TELEGRAM_ID>;
```

Для восстановления установить `is_active = true`, затем попросить пользователя выполнить `/кто`.

## Если бот молчит

1. Убедиться, что общение идёт в личном чате.
2. Проверить статус Edge Function `tg-hr-bot` и отсутствие 401, 403 и 5xx.
3. Проверить, что функция задеплоена с `verify_jwt = false`; Telegram не отправляет Supabase JWT.
4. Проверить наличие `tg_webhook_secret` и соответствие webhook.
5. Перерегистрировать webhook предусмотренным admin-действием `setup_webhook`, передавая код только из защищённого серверного контекста.
6. Проверить в ответе `url`, `pending_update_count`, `last_error_message` и `secret_ustanovlen=true`. Не возвращать сам секрет.

## Проверка создания карточки

Не создавать лишнюю production-карточку ради проверки доступа. Достаточно:

1. `/кто` — проверить доступ и подпись.
2. Отправить тестовый текст или фото до экрана подтверждения.
3. Нажать «Отмена» или выполнить `/cancel`.

Если карточка всё же создана, не удалять её без явного подтверждения владельца данных.
