# AU191-S2-TELEGRAM-BINDING-FLOW: Telegram — привязка пользователя

Версия (git rev-parse HEAD): `a2ba56bc2b8923bb31bbaa46b984b6c44b3e7c19`
Ветка: `hermes/q4-0926`. Дата среза: 2026-10-10.
Метод: только чтение; код приложения не менялся.

## Итог

- **Привязки пользователя к Telegram в коде НЕТ.** В системе вообще не существует
  персональной привязки: ни «своего» чата у пользователя, ни токена привязки, ни
  срока жизни, ни операции отвязки. Единственная сущность — `TelegramConfig`
  (бот-токен + ID чата) **на организацию**, которую заводит администратор.
- Уведомления уходят в **общий чат тенанта**; роль получателя код не знает и не
  различает (`src/core/notifications/telegram.ts:75-92`).
- Право `telegram.manage` есть **только у ADMIN**
  (`src/services/auth/authorization-service.ts:130`); экран закрыт клиентским
  гвардом `AdminOnly` (`src/components/piling/admin-only.tsx:19`).
- Смена роли/блокировка/смена пароля инвалидируют сессию через
  `sessionVersion` (`src/services/users/user-service.ts:237,249-251`; проверка —
  `src/lib/auth.ts:105`) — Telegram-специфичной логики при смене роли нет.
- Что проверено положительно: шифрование бот-токена и его маскировка, защита от
  IDOR по `tenantId`, след в аудите без секрета.
- Всего находок: 3 важно, 7 мелочь, 0 критично; 4 проверки — ПРОЙДЕНО.

## Методика

Поиски по репозиторию (можно повторить):

- `rg -i telegram` по `src/`, `prisma/`, `*.md` — 44 файла.
- Файловый поиск: `rg --files | rg -i telegram` → `src/app/api/telegram/configs/route.ts`,
  `src/app/api/notifications/telegram/test/route.ts`, `src/core/notifications/telegram*.ts`,
  `src/services/telegram/telegram-config-service.ts`, `src/components/piling/admin-telegram.tsx`.
- `rg -i "привяз|getUpdates|setWebhook|/start|bind"` по `src/` — совпадений по
  Telegram-привязке нет (все — про привязку выработки к пикету и CSS).
- `rg -i "botToken|chatId|telegramId|telegramChat"` по `prisma/schema.prisma` —
  только `TelegramConfig.botToken`/`chatId` (строки 2510-2511); у `User`
  (строки 93-147) полей Telegram нет.
- `rg "reply_markup|callback_query|inline_keyboard"` по `src/` — 0 совпадений
  (интерактивной привязки/подтверждений через бота нет).
- Структура API: `rg telegram` по `src/app/api` — входящих от Telegram маршрутов
  нет; `src/app/api/alerts/webhook/route.ts` — входящий вебхук от Alertmanager,
  Telegram там только как получатель исходящего.
- Роли/права: `rg telegram.manage` → `src/services/auth/authorization-service.ts:48,130`.
- Смена роли: `rg sessionVersion` → `src/services/users/user-service.ts:237,249-251`.

Числа (из команд): моделей с Telegram — 1; маршрутов Telegram — 2 + 1 вебхук;
совпадений inline_keyboard — 0; право `telegram.manage` — 1 роль (ADMIN).

## Фактический поток (то, что реально есть): настройка канала админом

Это единственный «поток Telegram» в системе. Персональной привязки пользователя
нет — таблица описывает то, что есть, и помечает отсутствующее.

| Шаг | Файл:строка | Проверка | Риск |
| --- | --- | --- | --- |
| 1. Вход на экран `/admin/telegram` | `src/app/(app)/admin/telegram/page.tsx:6-11`; `src/components/piling/admin-only.tsx:16-26` | ПРОЙДЕНО: не-ADMIN уводится на `/no-access` (`:22`) | Экран для оператора/диспетчера отсутствует по замыслу |
| 2. Чтение списка каналов | `src/app/api/telegram/configs/route.ts:40-53` | ПРОЙДЕНО: `assertCan(user,'telegram.manage')` (`:46`), `requireTenantId` (`:48`) | — |
| 3. Право на управление | `src/services/auth/authorization-service.ts:48,130` | ПРОЙДЕНО: `telegram.manage` = только `ADMIN` | Диспетчер не может настроить канал (так и задумано) |
| 4. Создание канала (POST) | `src/app/api/telegram/configs/route.ts:55-91` | ПРОЙДЕНО: zod `safeParse` (`:66`), 400 с details (`:67-72`) | — |
| 5. Валидация полей | `src/lib/validation-schemas.ts:317-322` | ГИПОТЕЗА/мелочь: `chatId` — любая строка до 500; формат ID чата сервер НЕ проверяет (проверка только в UI `admin-telegram.tsx:37,171-176`) | Опечатка в `chatId` через API/скрипт сохранится как рабочий канал |
| 6. Шифрование бот-токена | `src/services/telegram/telegram-config-service.ts:82-93` | ПРОЙДЕНО: `encrypt(botToken)` перед записью (`:83`) | — |
| 7. Маскировка токена в выдаче | `src/services/telegram/telegram-config-service.ts:26-28,46-57` | ПРОЙДЕНО: наружу только хвост `••••1234`, `hasBotToken` | — |
| 8. След в аудите | `src/app/api/telegram/configs/route.ts:29-36,79-88,117-125,162-172` | ПРОЙДЕНО: снимок без `botToken` (только `configId/label/chatId/enabled`) | — |
| 9. Тест соединения | `src/app/api/notifications/telegram/test/route.ts:24-41` | мелочь: право проверяется как `reports.read_all` (`:29`), а не `telegram.manage` | DISPATCHER (и в принципе FOREMAN/SAFETY_ENGINEER) может дёргать Telegram API по чужому id канала в своём тенанте |
| 10. Реальная отправка | `src/core/notifications/telegram.ts:221-253` | ПРОЙДЕНО: `sendMessage` через `TELEGRAM_API_BASE` (`:227`), таймаут 5с (`:230`) | — |
| 11. Классификация отказов | `src/core/notifications/telegram.ts:205-220` | мелочь: постоянный отказ выключает канал и дописывает причину в `label` (`:214`) | Правка `label` админом «затирает» пометку; повторного оповещения админу нет (только `logger.warn`) |
| 12. Дедуп чатов | `src/core/notifications/telegram.ts:80-86` | ПРОЙДЕНО: один и тот же `chatId` не дублируется | — |
| 13. Отвязка пользователя | — (нет файла) | НЕ ПРОВЕРЕНО, т.к. отсутствует: модели/маршрута/кнопки «отвязать Telegram» нет | — |
| 14. Токен привязки и срок жизни | — (нет файла) | НЕ ПРОВЕРЕНО, т.к. отсутствует: ни поля, ни модели, ни TTL | — |
| 15. Смена роли | `src/services/users/user-service.ts:249-251`; `src/lib/auth.ts:105` | ПРОЙДЕНО: смена роли => `sessionVersion++` => сессия недействительна | Telegram-логики нет; потеря ADMIN = потеря доступа к `/admin/telegram` |

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как чинить |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `prisma/schema.prisma:2506-2518`; `src/core/notifications/telegram.ts:75-92` | Нет персональной привязки: `TelegramConfig` — общий чат на организацию; роль получателя не учитывается | Все получают все: оператор, диспетчер и админ видят одни и те же алерты; адресного уведомления «своему мастеру» нет | Ввести модель привязки пользователя к чату (userId + chatId + дата/статус) и маршрутизацию по роли/получателю |
| 2 | важно | — (отсутствует) | Нет токена привязки, нет TTL, нет операции отвязки | Задачу «привязать пользователя по коду» код выполнить не может: ни `bindCode`, ни срока действия, ни «отвязать» | Спроектировать: одноразовый код привязки с TTL, экран/бот-команда привязки и отвязки |
| 3 | важно | `src/app/api/notifications/telegram/test/route.ts:29` | Тест канала защищён `reports.read_all`, а не `telegram.manage` | Право слабее, чем у управления каналом; носитель `reports.read_all` может инициировать исходящий запрос к Telegram | Заменить на `assertCan(user,'telegram.manage')` |
| 4 | мелочь | `src/lib/validation-schemas.ts:320` | `chatId` не валидируется по формату на сервере | Ошибочный/подставленный `chatId` сохраняется и «выглядит рабочим», алерты уходят в никуда | Добавить `regex` формата ID чата на сервер (как `CHAT_ID_PATTERN` в UI) |
| 5 | мелочь | `src/core/notifications/telegram.ts:214` | Автоотключение канала дописывает причину в `label` | Метка канала перестаёт быть именем, заданным админом; при повторной правке причина теряется | Хранить причину отдельным полем, а не в `label` |
| 6 | мелочь | `src/core/notifications/telegram.ts:8-10` | Docstring обещает inline-кнопки подтверждения (acknowledge/dismiss) | В коде `reply_markup`/`callback_query` нет (rg: 0) — документация расходится с поведением; «подтверждения» в чате нет | Привести комментарий к факту либо реализовать |
| 7 | мелочь | `src/services/telegram/telegram-config-service.ts:114,148` | Перед update/delete — отдельный `findFirst` по `tenantId`, затем операция по `id` | Гонка: между проверкой и записью запись удалили/сменили; обрабатывается через P2025 (`:132-138,155-161`), но не атомарно | Использовать `updateMany/deleteMany` с условием `id AND tenantId` (одна операция) |
| 8 | мелочь | `src/app/api/telegram/configs/route.ts:52`; `src/components/piling/to/readiness/settings/notifications-section.tsx:224-225` | GET кешируется 60с (`{ cache:true, cacheTTL:60_000 }`), а экран обещает «Журнал доставки» | Журнала доставки в модуле нет (комментарий это признаёт) — но кнопка ведёт на тот же экран; кеш может показать устаревший список каналов | Убрать кнопку/честно назвать; либо меньше TTL |
| 9 | мелочь | `src/components/piling/workspace-settings.tsx:222` | Вкладка Telegram скрыта от не-ADMIN по клиентскому признаку `isAdmin` | Это лишь UI: API всё равно 403 (проверка есть), но признак роли берётся на клиенте | Оставить (страховка на сервере уже есть); не полагаться только на клиент |
| 10 | мелочь | `src/app/api/notifications/telegram/test/route.ts:40` | На любой отказ `testConnection` маршрут отвечает HTTP 500 | 500 маскирует прикладную ошибку (неверный токен/чат) под «ошибку сервера» в мониторинге | Отдавать 400/502 с телом ошибки |

### Проверки, которые ПРОЙДЕНО (положительный результат)

| # | path:line | Что проверено и результат |
| --- | --- | --- |
| P1 | `src/services/telegram/telegram-config-service.ts:83,122` | Бот-токен шифруется перед записью в БД (AES, `encrypt`) |
| P2 | `src/services/telegram/telegram-config-service.ts:26-28,46-57` | Полный токен наружу не отдаётся — только хвост `••••NNNN` |
| P3 | `src/services/telegram/telegram-config-service.ts:114,148`; `src/app/api/telegram/configs/route.ts:154` | Защита от IDOR: правка/удаление/тест — строго по `id AND tenantId` |
| P4 | `src/app/api/telegram/configs/route.ts:29-36,79-88` | Аудит хранит снимок канала без секрета; токена в следе нет |

## Не проверено

- **Персональная привязка, токен привязки, TTL, отвязка** — НЕ ПРОВЕРЕНО,
  **потому что отсутствуют в коде**. Основание: `prisma/schema.prisma:93-147`
  (у `User` нет Telegram-полей), `:2506-2518` (единственная модель — канал), ноль
  маршрутов входящих сообщений от Telegram, ноль совпадений `getUpdates|setWebhook|/start`.
- **Живая отправка в Telegram** не выполнялась: `TELEGRAM_API_BASE` и токен не
  задавались, наружу никаких запросов не делалось. Оценивался только код.
- **Поведение бота в чате** (команды, привязка через бота) не проверялось —
  обработчика входящих сообщений в репозитории нет.
- **Реальная БД/RLS** не проверялись: аудит только по исходникам.
- **Ротация/смена `ENCRYPTION_KEY`** и её влияние на чтение старых токенов — по
  коду видна обработка (`telegram-config-service.ts:49-55`: нечитаемый токен →
  «без токена»), но фактическая проверка не выполнялась.
- Задержка прод-прокси Cloudflare (`TELEGRAM_API_BASE`) относительно 5-секундного
  таймаута (`src/core/notifications/telegram.ts:230`) не измерялась (ГИПОТЕЗА).
- Отчёт писался на ветке `hermes/q4-0926` при HEAD `a2ba56bc…`; рабочее дерево
  содержало незакоммиченное изменение `AGENTS.md` — постороннее, не трогал.
