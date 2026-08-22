# Авария фото и презентации

## Зафиксированный инцидент 17.08.2026

Симптомы:

- `/rookies` стал отдавать 404;
- `/present` показывал инициалы вместо фотографий;
- в список попали 201 строка отчёта без описаний вместо карточек, присланных HR;
- прямые signed/public URL Supabase Storage давали в Chrome `ERR_CONNECTION_RESET` и `ERR_HTTP2_PING_FAILED`, хотя `fetch` мог вернуть `200`;
- новый деплой получил пустой `PODBOR_CODE`.

Причины:

1. Vercel был задеплоен из неполного локального исходника без `app/rookies/route.ts`.
2. Действие `hr-present: people` выбирало все неархивные строки, включая импорт отчёта без фото.
3. Браузер нестабильно загружал множество изображений напрямую с домена Supabase Storage.
4. Переменная Vercel `PODBOR_CODE` существовала, но имела пустое значение.

Данные не были потеряны. Они оставались в `podbor_people`, а файлы — в bucket `candidates`, каталогах `inbox/` и `ppt/`.

## Правильная бизнес-логика

- На общем экране презентации показывать только неархивные карточки с реальным `photo_path`.
- Потенциальный кандидат может существовать до появления в Borboza; для презентации достаточно карточки из бота или веба с фото.
- Описание брать из `podbor_people.description`.
- Дату выхода брать из `podbor_people.internship_on`.
- Подпись HR разрешать живьём через `author_tg -> podbor_bot_users.telegram_id`, чтобы переименование HR обновляло старые карточки.
- В `/rookies` KPI брать из `rookies_view`; фото появляется только у сопоставленной карточки `podbor_people`.

### Сопоставление фото на экране новичков

В Borboza и презентации один человек может временно существовать двумя строками: автоматическая строка с `external_id` и KPI без фото, а также Telegram-карточка с фото без `external_id`. Для отображения `/rookies` не копировать файл и не объединять строки автоматически.

- Искать источник фото только среди активных `podbor_people` с заполненным `photo_path`.
- Сравнивать ФИО без регистра, пунктуации, `ё/е` и порядка слов; допустимо отсутствие одного отчества.
- Если город заполнен с обеих сторон, он обязан совпадать.
- Использовать фото только при единственном совпадении; дубли оставлять на ручное связывание.
- Подставлять существующий `photo_path` через `/api/photo`, не создавать второй объект Storage.
- Карточки с `archived = true` не должны возвращать фото в `/rookies`.

## Диагностика

### 1. Проверить production-деплой

```powershell
npx vercel inspect https://hr.tools.rlevelai.ru
npx vercel ls podbor-hh
```

Сверить deployment ID, дату и project name. Не предполагать, что локальная папка соответствует production.

### 2. Проверить состав исходника и сборки

В Next.js-проекте должны существовать:

- `app/present/route.ts`
- `app/rookies/route.ts`
- `app/api/photo/route.ts`

В build-выводе должны быть:

```text
ƒ /api/photo
ƒ /present
ƒ /rookies
```

Если `/rookies` отсутствует, не деплоить. Восстановить маршрут:

```ts
import { NextRequest } from 'next/server';
import { renderScreen, submitForm } from '../../lib/ui';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return renderScreen('hr-rookies', req);
}

export async function POST(req: NextRequest) {
  return submitForm('hr-rookies', req, '/rookies');
}
```

### 3. Проверить данные, не изменяя их

В `hr-present`, действие `people`, должен использоваться фильтр:

```ts
.eq("archived", false)
.not("photo_path", "is", null)
```

Выбирать поля:

```text
id, full_name, city, age, description, photo_path,
internship_on, created_at, hr_manager, author_tg
```

Проверить агрегаты, не печатая ФИО и секреты: количество карточек, фото, описаний и дат. На момент исправления было 27 карточек; число может расти.

### 4. Проверить прокси фотографий

`app/api/photo/route.ts` должен:

- принимать только относительный `path`;
- отклонять пустой путь, `..` и начальный `/`;
- кодировать каждый сегмент пути;
- сервером получать файл из `candidates`;
- возвращать upstream body и корректный `Content-Type`;
- не передавать service-role key браузеру.

Пример проверки:

```powershell
curl.exe -L -sS -o NUL -w "%{http_code} %{content_type} %{size_download}\n" "https://hr.tools.rlevelai.ru/api/photo?path=inbox%2F<file>.jpg"
```

Ожидать `200 image/jpeg` или другой `image/*`.

Middleware обязан исключать `api/photo` из авторизации, иначе изображения на публичных подборках будут редиректиться на login:

```ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|no-access|p/|api/public|api/photo).*)']
```

### 5. Проверить коды доступа

- Next.js использует `PODBOR_CODE` в Vercel.
- Edge Functions используют `HH_UI_CODE` или предусмотренное функцией резервное значение.
- Значения должны совпадать и не быть пустыми.

Проверять наличие и длину, не печатать значение. После изменения Vercel env обязательно создать новый deployment: старый deployment не получает новое окружение.

### 6. Проверить готовый HTML

Вызвать `hr-ui-present` и `hr-rookies` через защищённый серверный контекст. Вывести только агрегаты:

- длина HTML;
- количество `/api/photo?path=`;
- количество блоков описания и даты;
- наличие текста ошибки.

Зафиксированная успешная проверка после лечения:

```text
present: HTML 31271, фото 27, описания присутствуют, даты присутствуют, error=false
rookies: HTML 132804, фото 4, error=false
photo proxy: 200 image/jpeg, 79206 bytes
```

## Лечение

1. Если последний deployment неполный, сначала вернуть предыдущий рабочий deployment командой `vercel promote <working-url>`.
2. Добавить отсутствующий `/rookies` в полный исходник.
3. Ограничить `hr-present: people` карточками с `photo_path`.
4. Возвращать из `hr-present` относительный URL `/api/photo?path=...`.
5. Добавить серверный `/api/photo` и исключить его из middleware.
6. Проверить, что `PODBOR_CODE` непустой и совпадает с Edge Function.
7. Задеплоить `hr-present`, затем Next.js production.
8. Проверить маршруты, HTML, фото и error logs.
9. Удалить временные env-файлы после проверки.

## Чего не делать

- Не создавать новые таблицы или миграции для восстановления существующих фото.
- Не архивировать строки `report`, чтобы визуально уменьшить список: фильтр принадлежит API.
- Не заменять `photo_path` массово.
- Не считать перевод bucket в public полноценным лечением HTTP/2 reset: финальное решение — same-origin серверный прокси.
- Не просить пользователя выполнять JavaScript в консоли, пока серверные проверки не исчерпаны.
