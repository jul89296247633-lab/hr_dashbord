# Runbook корректировок и восстановления

## 1. До изменения

1. Зафиксировать симптом, URL, время и ожидаемое поведение.
2. Выполнить `git status --short` в обоих исходниках, если затронут сайт.
3. Не откатывать и не перезаписывать чужие незакоммиченные изменения.
4. Определить слой по [ARCHITECTURE.md](ARCHITECTURE.md).
5. Прочитать существующий feature spec или создать новый с критериями приёмки.
6. Сначала провести read-only диагностику, затем менять минимальный слой.

## 2. Безопасные корректировки Edge Functions

После локальной проверки деплоить только затронутые функции:

```powershell
supabase functions deploy hr-present --project-ref twfmfmkqfhclzvdogvix --no-verify-jwt --use-api
supabase functions deploy hr-ui-present --project-ref twfmfmkqfhclzvdogvix --no-verify-jwt --use-api
supabase functions deploy hr-rookies --project-ref twfmfmkqfhclzvdogvix --no-verify-jwt --use-api
supabase functions deploy tg-hr-bot --project-ref twfmfmkqfhclzvdogvix --no-verify-jwt --use-api
```

Не деплоить все функции без необходимости. После деплоя проверить GET health функции и реальный пользовательский маршрут.

## 3. Корректировки Next.js-прокси

Работать из `C:\Users\admin\Desktop\id-tools\podborhhsource\podbor-sso`.

Перед production-деплоем:

```powershell
npm run build
```

В build-выводе обязаны присутствовать:

```text
/api/photo
/present
/rookies
```

Проверить привязку Vercel к проекту `podbor-hh`, затем деплоить штатным Vercel-процессом. После изменения env всегда нужен новый deployment.

## 4. Изменения БД и миграций

1. Для визуальной ошибки не менять схему и историю миграций.
2. Новую схему оформлять только новой миграцией, созданной штатной командой Supabase CLI.
3. Перед применением проверить SQL, RLS, grants, обратимость и план отката.
4. Сверить локальную и remote-историю миграций до `db push`.
5. Если remote-версии отсутствуют локально, остановиться и восстановить оригинальные SQL-файлы из канонического git/источника. Не создавать пустые placeholder-файлы.
6. `migration repair` использовать только после документированной сверки фактической схемы и отдельного решения администратора БД.
7. Не выполнять массовые `update/delete/archive` без предварительного `select count(*)`, конкретного условия, транзакции/rollback-плана и явного подтверждения владельца данных.

## 5. Smoke-test production

Маршруты:

```powershell
curl.exe --max-time 20 -L -sS -o NUL -w "%{http_code} %{content_type}\n" https://hr.tools.rlevelai.ru/present
curl.exe --max-time 20 -L -sS -o NUL -w "%{http_code} %{content_type}\n" https://hr.tools.rlevelai.ru/rookies
```

Ожидать `200 text/html`. Для фото использовать известный относительный `photo_path`, не signed URL:

```powershell
curl.exe --max-time 20 -L -sS -o NUL -w "%{http_code} %{content_type} %{size_download}\n" "https://hr.tools.rlevelai.ru/api/photo?path=<URL_ENCODED_PATH>"
```

Ожидать `200 image/*` и ненулевой размер. В диагностическом выводе использовать только агрегаты: количество карточек, фото, описаний, дат и ошибок; не печатать ФИО и секреты.

## 6. Типовые инциденты

### Фото или описания пропали

Использовать [photo-presentation-incident.md](../../.agents/skills/podbor-hr-support/references/photo-presentation-incident.md). Проверять по порядку: данные → Storage → `hr-present` → UI function → `/api/photo` → browser.

### Новички не получают фото

1. Проверить, есть ли активная презентационная карточка с `photo_path`.
2. Проверить уникальность ФИО и совпадение города.
3. Не использовать архивные карточки.
4. При двух совпадениях выполнить ручное связывание, не выбирать автоматически.
5. Не копировать объект Storage: оба экрана должны использовать один `photo_path`.

### Кандидата нужно убрать из активного списка

Использовать кнопку `Сошла с дистанции досрочно` только для карточки без `external_id`. Действие устанавливает `archived=true`; строка, фото и старые подборки сохраняются. Подтверждённого Borboza-кандидата сервер обязан отклонить.

### Telegram-бот не отвечает или нужен новый HR

Использовать [telegram-users.md](../../.agents/skills/podbor-hr-support/references/telegram-users.md). Проверить личный чат, активность пользователя, Edge Function, webhook и secret. Не создавать администратора автоматически.

### Миграции расходятся

Не повторять `migration list/fetch/push` по кругу. Зафиксировать последнюю завершённую команду, remote versions и локальные файлы; восстановить оригинальные миграции из источника истины. Не менять history table до сверки фактической схемы.

## 7. Откат

### Edge Function

Восстановить предыдущую проверенную версию файла из git и повторно задеплоить только эту функцию. Не откатывать БД ради ошибки HTML.

### Vercel

Найти последний рабочий deployment через `npx vercel ls podbor-hh` и вернуть его штатным promote/rollback-механизмом Vercel. После отката проверить `/present`, `/rookies` и `/api/photo`.

### Данные

Использовать заранее подготовленную обратную SQL-операцию или транзакционный rollback. Удаление production-данных без резервного плана запрещено.

## 8. Завершение работы

- Критерии feature spec выполнены.
- Production route и связанные Edge Functions проверены.
- Нет новых 5xx и ошибок браузера.
- Фото проверено через `/api/photo`.
- Изменённые файлы и тесты перечислены.
- Оставшиеся риски и способ отката зафиксированы.
- Документация обновлена, если изменились доступы, архитектура или процедура.
