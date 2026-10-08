# Разбор Hermes W116–W127

Дата: 08.10.2026. Ветка: `codex/audits-w116-127`. Дерево: `D:/PillingR/wt-codex-audits`.
База: свежий локальный `main`, `0f53cd01a264ffae97e3eaa7fea7582d90bf657d`.

Работа выполнена в отдельном дереве. Исходное дерево `D:/PillingR/my-project` и чужие изменения не использовались для правок. Слияния, отправки, выкладки, SSH и обращения к рабочей БД не было. Схема, миграции, зависимости, файлы окружения, защищённая авторизация, RLS, варианты машиниста и ORION не изменены.

## Исходные материалы и решения

W116–W126 прочитаны в `D:/PillingR/wt-night/docs/audits/hermes-night/`: этих отчётов нет в выбранном main. Готовый отчёт W127 не найден. Для него прочитано задание `D:/PillingR/night-logs/tasks/W127-SELECT-SECRET-FIELDS.md` и выполнена самостоятельная проверка выборок и выходных DTO. Наличие готового отчёта W127 не утверждается.

| Отчёт | Результат проверки текущего кода |
| --- | --- |
| W116, выборки без tenant | Утечка OPERATOR/ASSISTANT не подтверждена. Часть выборок защищена принадлежностью родительской записи; общий доступ ADMIN/DISPATCHER предусмотрен владельцем. Предложения дополнительного tenant-фильтра относятся к защищённой зоне и подготовке второго арендатора. |
| W117, изменения без аудита | Добавлены 15 видов событий после успешного изменения, включая разбор происшествия, осмотры, инструктажи, документы, топливо, план ТО, автоматический наряд, очередь ошибок и удаление вложения. Для ленты добавлены русские названия и области. Обнаруженная при проверке неатомарная замена шаблона исправлена отдельно. |
| W118, флаги | Проверки `!== 'false'` действительно позволяют отключить соответствующие задачи. Отсутствие переменной в compose не делает флаг мёртвым. Opt-in очистки не включались; телеметрия и аудит цепочки не удалены как «лишние». |
| W119, перечисления | Исправлен словарь статусов устройств: PROVISIONED, ACTIVE, DEGRADED, OFFLINE, ARCHIVED. DEGRADED не считается исправно подключённым устройством. Неиспользуемые словари и резервные схемы не переписывались. |
| W120, ошибки API | Утечка SQL, паролей или стека через проверенные ответы не подтверждена. Проверяемый catch композиции checklist сейчас возвращает ограниченные служебные ошибки; ошибки Zod используются интерфейсом для объяснения неверного ввода. |
| W121, фоновые задачи | Запрещено наложение часовых пересчётов, остановка прекращает переход к следующим объектам, обработчики сигналов снимаются. Health учитывает включённые задачи; очистка PDF оставляет пульс после успешного прохода. Если отключены все учитываемые задачи, отсутствие Redis не создаёт ложную тревогу. |
| W122, события без обработчиков | 14 событий бригад/объектов/техники явно объявлены журналом в `domain-events.ts`; их отсутствие в проекциях не доказывает потерю данных. No-op неизвестного события закреплён интеграционным контрактом. Заготовки будущих событий не удалены. |
| W123, TODO | Обнаруженные комментарии и шаблоны генератора не подтверждают действующий дефект. Косметическая чистка не выполнялась. |
| W124, server actions | В проверенном исходном коде отсутствуют server actions с `use server`; исправлять нечего. |
| W125, ключи лимитов | «Критическая» подмена X-Forwarded-For через стандартный Caddy не подтверждена: он по умолчанию игнорирует входящие значения X-Forwarded-* при формировании этих заголовков. Порог двух маршрутов телеметрии одинаков и общий ключ закреплён тестом. ORION не делит корзину с телеметрией: у последней уже есть префикс `telemetry:`, а ingest имеет отдельный `telemetry:ingest:`. Замечания о Host/x-real-ip требуют отдельной работы в запрещённой зоне авторизации/лимитов. |
| W126, даты | Исправлены границы топливной аналитики, московский день ТО и подписей сроков, даты форм топлива/моточасов, окно мониторинга, 30-дневная граница отчётов, имена трёх выгрузок, расчёт срока документа на конце месяца. Переход всего приложения к настройкам будущего арендатора не выполнялся. |
| W127, секретные поля | Пароли, PIN, keyHash и botToken в проверенных клиентских DTO не обнаружены. TelegramConfig удаляет токен перед выдачей и возвращает только признак/хвост; серверная отправка использует токен внутри сервера. sessionVersion присутствует в ответе входа: служебное поле, не пароль. Auth-зона оставлена без изменения. |

Сведения о поведении Caddy сверены с [официальным описанием reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults). Рабочий сервер и его фактическая конфигурация не проверялись.

## Что исправлено

1. **Журнал операций.** Событие записывается после завершения основной операции, с фактическим идентификатором и актором. Планировщик указан как автоматический исполнитель. Отказы записи, неверный ввод, отсутствие входа/права, повтор подписи, повтор разбора, неуспешная переотправка и повтор удаления вложения не создают ложной записи об успехе. Существующая best-effort политика журнала сохранена: отказ инфраструктуры аудита не откатывает основную операцию.
2. **Шаблоны осмотра.** Отключение старого и создание нового выполняются одной транзакцией. Проверены отказы создания и фиксации, успешная замена и сохранение прежних отказов доступа. Проверки принадлежности и тело вложенного создания сохранены.
3. **Фоновые задачи.** Часовой проход проекций имеет собственный флаг выполнения; после stop не начинается следующий объект/арендатор. Outbox и projection снимают свои SIGTERM/SIGINT-обработчики. Список ожидаемых пульсов отражает флаги включения. PDF-cleanup пишет пульс только после успешного, не прерванного прохода.
4. **Календарь.** Дата ТО считается просроченной со следующего производственного дня, а не с полуночи UTC внутри планового дня. Date-only значения сохраняют календарную дату; полные timestamp переводятся в московский день. Формы продолжают отправлять прежнюю строку `YYYY-MM-DD`. Мониторинг сохраняет включительное окончание: следующая московская полночь минус 1 мс. 31 января + месяц становится последним днём февраля.
5. **Периоды и выгрузки.** Топливная аналитика читает `[начало первого дня; начало дня после последнего)`, поэтому учитывает начало московского дня и последний миллисекундный остаток, не захватывая следующий день. Часовой пояс берётся на границе API из настроек и передаётся сервису. 30-дневная граница карточки техники и имена выгрузок отчётов/паспортов используют настройки организации; готовность использует свой уже рассчитанный timezone и единый generatedAt.
6. **Статусы устройств.** В интерфейсе вместо сырых кодов показываются русские подписи актуального перечисления; исправным подключением считается ACTIVE.

Новых тестовых файлов три: параметризованный контракт аудита маршрутов, интеграции готовности и окно мониторинга. Остальные проверки добавлены в существующие наборы. Это регрессии запрошенных исправлений, а не расширение набора для косметики.

Файлы не удалялись. Локальная неэкспортируемая функция `daysUntil` в `admin-dashboard.tsx` заменена импортом общего помощника. Поиск по исходникам, тестам, e2e, scripts, prisma и конфигурации подтвердил один локальный вызов, сохранённый после замены (`dates-browser-callers.log`).

## GitNexus и область влияния

MCP GitNexus недоступен. Запуск `.gitnexus/run.cjs` с обычным Node и повтор с доступным Node 24 завершились кодом 1: не установилась нативная часть `@ladybugdb/core`; сборщик не смог запустить `cmd.exe`. Результата графового impact/detect_changes нет. **Риск графа: UNKNOWN.**

Владелец отдельно разрешил для этой задачи заменить графовую проверку текстовым поиском и разницей изменений. До правок проверены вызывающие участки, до коммитов проверена общая разница. Логи: `impact-maintenance.log`, `*-callers.log`, `precommit-fallback.diff`, `precommit-fallback-numstat.log` в `D:/PillingR/wt-codex-audits/output/codex-w116-127/`. Текстовая проверка не называется проверкой графа и не даёт количества процессов GitNexus.

Текстовые пути влияния: API → команды осмотров/ТО → журнал; lifecycle unified-worker → outbox/projection/PDF → health; API аналитики и карточки техники → календарные окна; admin-dashboard/таблицы ТО/флаги → общие подписи сроков. Изменяемые обработчики API используются маршрутизатором Next и тестами. Защищённые файлы не менялись.

## Проверки

Все команды запускались отдельно; ниже указывается реальный код процесса. Полные логи сохранены в `output/codex-w116-127/`, не включены в исходники.

| Команда/проверка | Код | Результат |
| --- | ---: | --- |
| Удаление устаревших `.next/dev/types` в собственном дереве | 0 | Каталог отсутствовал; сторонние пути не затрагивались. |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 | Финальная проверка типов без ошибок. |
| `npm run lint` | 0 | Финальная проверка: 0 ошибок, 0 предупреждений; целостность текстов пройдена. |
| `npm run test:unit -- --maxWorkers=2` | 1 | 3913 passed / 1 failed (timeout 30 с) / 2 expected fail / 257 skipped; 373 passed / 1 failed / 14 skipped файлов. Лог `unit-full.log`. |
| Отдельный `unified-worker.test.ts --maxWorkers=1` | 0 | 11 passed / 0 skipped. Прежний таймаут 30 с не менялся. Лог `unified-isolated.log`. |
| `npm run test:unit -- --maxWorkers=1` | 0 | 3914 passed / 0 unexpected failed / 2 expected fail / 257 skipped; 374 passed / 14 skipped файлов. Весь набор: 4173 теста, 388 файлов, 635,82 с. Лог `unit-full-serial.log`. |
| Playwright `test --list` | 0 | 291 тест в 27 файлах; браузерные сценарии не запускались. Существующие e2e-файлы не изменялись. |
| `npm run build` | 1 | validate-env остановил сборку: отсутствуют DATABASE_PROVIDER и SESSION_SECRET. Next build и его проверка типов маршрутов не выполнены. |
| `npm run db:generate` | 1 | Стандартная конфигурация требует DATABASE_URL_POSTGRES. |
| `node node_modules/prisma/build/index.js generate --config output/codex-w116-127/generate.config.ts` | 0 | Созданы типы в собственном ignored `src/generated`, без datasource/URL и без соединения с БД. |
| `node scripts/patch-postgres-client.js` | 0 | Штатная коррекция сгенерированного клиента. |
| `git diff --check` | 0 | Ошибок пробелов нет. |

Коллекция Playwright выполнена напрямую установленным CLI с локальным `--require`-ограничителем. Он разрешает только `--list`, блокирует чтение файлов окружения и паролей, запрещает записи за пределами собственного дерева. QA_RUN_DIR и кеш указаны внутри `output`. Упоминание числа тестов означает только успешную коллекцию.

Команда коллекции: `node --require ./output/codex-w116-127/playwright-list-guard.cjs node_modules/@playwright/test/cli.js test --list`. Временный `generate.config.ts` содержит только:

```ts
import { defineConfig } from 'prisma/config';
export default defineConfig({ schema: '../../prisma/schema.prisma' });
```

Общий и отдельный запуск unified-worker выводят существующие MaxListenersExceededWarning при повторных импортах в тестах, а Vitest — предупреждение о будущем configLoader. Это не предупреждения финального ESLint; тестовые таймауты и конфигурация ради зелёного результата не увеличивались. Отдельный повтор не объявлялся успешным повтором всего набора; после него выполнен полный последовательный прогон с кодом 0.

Профильные регрессии до и после правок:

| Набор | RED, код 1 | Финальный GREEN, код 0 |
| --- | --- | --- |
| W117, маршруты | 13 failed / 42 passed | В общем профильном наборе ниже |
| W117, команды и подписи | 18 failed / 98 passed | 212 passed / 0 skipped, 6 файлов, включая шаблон и области ленты |
| Атомарный шаблон и подписи областей | 5 failed / 13 passed | В том же наборе 212 |
| W121, workers/health/PDF | 12 failed / 46 passed | 60 passed / 0 skipped, 4 файла |
| Начальные календарные регрессии | 9 failed / 33 passed | 42 passed / 0 skipped, 3 файла |
| Статусы устройства | 2 failed | 2 passed / 0 skipped |
| Даты браузера и косвенные вызовы | 10 failed / 53 passed | 98 passed / 0 skipped, 7 файлов |
| Периоды/имена отчётов и паспортов | 4 failed / 60 passed | 64 passed / 0 skipped, 4 файла; дополнительный финальный тест timezone сервиса — 10 passed |
| Имя выгрузки готовности | 1 failed / 7 passed | 8 passed / 0 skipped |

Промежуточные неудачи не скрыты: первый tsc нашёл четыре неполные тестовые структуры (исправлены явными null-полями); первый lint сообщил одно новое нарушение направления импорта (настройки перенесены из сервиса на границу API). В промежуточном audit-прогоне девять ожиданий ошибочно требовали 400 вместо существующего 403 — исправлены тестовые ожидания, проверки доступа не менялись. В первом browser RED одна фикстура имела timeout из-за замороженных часов; исправленная фикстура затем показала два ожидаемых падения границ окна. Дополнительный ранний прогон дат пересёкся с RED топлива другого участника и завершился неуспешно — общим зелёным результатом он не считается.

## Ограничения и оставшиеся вопросы

- Сборка и проверка типов маршрутов Next требуют штатного окружения. `.env` не читался и значения для обхода проверки не придумывались.
- Живые БД/Redis, production и браузерные действия не проверялись. Интеграции без доступного URL могут быть пропущены; точные количества общего прогона указываются выше.
- GitNexus остаётся UNKNOWN после разрешённой замены. Полнота графового влияния не доказана.
- В W125 пути Host/x-real-ip находятся в [rate-limiter.ts](D:/PillingR/wt-codex-audits/src/lib/rate-limiter.ts:478), который прямо запрещён для правок AGENTS.md. Host используется в fallback на строке 504; x-real-ip — на 482–483. Рабочее прохождение чужого Host через доменный матчер Caddy не проверено. Это остаток для отдельной разрешённой задачи. Критичность замечания о стандартном X-Forwarded-For Caddy снята только по коду и официальной документации.
- В W117 выпуск/отзыв ключей устройств находится в [device-key-service.ts](D:/PillingR/wt-codex-audits/src/services/telemetry/device-key-service.ts:72) и [маршруте device-keys](D:/PillingR/wt-codex-audits/src/app/api/equipment/[id]/device-keys/route.ts:72). Эти пути выдают и отзывают право машинной аутентификации; правило запрета security-critical файлов применено к ним, исправление аудита ключей оставлено для отдельного разрешения. Отдельный вопрос гарантированной доставки аудита при отказе БД не решается существующим best-effort журналом.
- В W127 служебный sessionVersion остаётся в ответе входа. Это не высокая утечка секрета; файл auth-service запрещён для правок.
- Переход к часовым поясам второго арендатора, SQL partition/DDL и RLS не выполнялся. Исправления клиентского календаря используют текущую Москву; серверные окна, где настройки уже доступны, используют timezone организации.
- Opt-in idempotency-cleanup не включён. Его ранее отмеченные вопросы защищённых таблиц/многоарендной работы и решение о нескольких репликах не закрыты этой работой.

Независимый субагент проверил разницу аудита, атомарного шаблона, календаря и статусов устройств; подтверждённых регрессий не нашёл. Это проверка исходников, без живой БД и браузера. После коммитов исходное дерево по-прежнему на `main` / `0f53cd01`, с теми же чужими изменениями AGENTS.md и `public/orion-concept-protokol.html`.

## Коммиты и изменённые файлы

| Коммит | Изменение | Файлов | + / − строк |
| --- | --- | ---: | ---: |
| `7cd2db0d` | W117: журнал и подписи | 20 | 429 / 4 |
| `0fae41e7` | Атомарная замена шаблона | 2 | 90 / 9 |
| `b00a10bb` | W121: фоновые задачи и health | 9 | 199 / 27 |
| `dce5df5d` | W126: календарь и формы | 14 | 234 / 40 |
| `ced18262` | W126: серверные окна и выгрузки | 11 | 115 / 14 |
| `fc78e7fd` | W119: статусы устройств | 2 | 51 / 3 |

Итого код и тесты: **58 файлов, +1118 / −97 строк**. Отчёт добавлен отдельным коммитом после получения окончательных результатов проверок.

| Файл в собственном дереве | + | − |
| --- | ---: | ---: |
| [src/app/api/__tests__/mutation-audit.test.ts](D:/PillingR/wt-codex-audits/src/app/api/__tests__/mutation-audit.test.ts) | 200 | 0 |
| [src/app/api/admin/dlq/route.ts](D:/PillingR/wt-codex-audits/src/app/api/admin/dlq/route.ts) | 7 | 0 |
| [src/app/api/admin/equipment-analytics/route.ts](D:/PillingR/wt-codex-audits/src/app/api/admin/equipment-analytics/route.ts) | 3 | 0 |
| [src/app/api/admin/incidents/route.ts](D:/PillingR/wt-codex-audits/src/app/api/admin/incidents/route.ts) | 7 | 0 |
| [src/app/api/briefings/[id]/sign/route.ts](D:/PillingR/wt-codex-audits/src/app/api/briefings/[id]/sign/route.ts) | 6 | 0 |
| [src/app/api/briefings/route.ts](D:/PillingR/wt-codex-audits/src/app/api/briefings/route.ts) | 6 | 0 |
| [src/app/api/checklist-templates/[id]/route.ts](D:/PillingR/wt-codex-audits/src/app/api/checklist-templates/[id]/route.ts) | 9 | 0 |
| [src/app/api/checklist-templates/route.ts](D:/PillingR/wt-codex-audits/src/app/api/checklist-templates/route.ts) | 5 | 0 |
| [src/app/api/equipment/[id]/documents/route.ts](D:/PillingR/wt-codex-audits/src/app/api/equipment/[id]/documents/route.ts) | 6 | 0 |
| [src/app/api/equipment/[id]/fuel/route.ts](D:/PillingR/wt-codex-audits/src/app/api/equipment/[id]/fuel/route.ts) | 6 | 0 |
| [src/app/api/inspections/[id]/route.ts](D:/PillingR/wt-codex-audits/src/app/api/inspections/[id]/route.ts) | 5 | 0 |
| [src/app/api/maintenance-plans/route.ts](D:/PillingR/wt-codex-audits/src/app/api/maintenance-plans/route.ts) | 5 | 0 |
| [src/app/api/media/[id]/route.ts](D:/PillingR/wt-codex-audits/src/app/api/media/[id]/route.ts) | 5 | 0 |
| [src/app/api/pile-passports/export/__tests__/route.test.ts](D:/PillingR/wt-codex-audits/src/app/api/pile-passports/export/__tests__/route.test.ts) | 11 | 1 |
| [src/app/api/pile-passports/export/route.ts](D:/PillingR/wt-codex-audits/src/app/api/pile-passports/export/route.ts) | 4 | 1 |
| [src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts](D:/PillingR/wt-codex-audits/src/app/api/readiness/_shared/__tests__/routes-read-capability.test.ts) | 34 | 2 |
| [src/app/api/readiness/export/route.ts](D:/PillingR/wt-codex-audits/src/app/api/readiness/export/route.ts) | 2 | 1 |
| [src/app/api/reports/export/__tests__/route.test.ts](D:/PillingR/wt-codex-audits/src/app/api/reports/export/__tests__/route.test.ts) | 12 | 1 |
| [src/app/api/reports/export/route.ts](D:/PillingR/wt-codex-audits/src/app/api/reports/export/route.ts) | 4 | 1 |
| [src/components/piling/__tests__/admin-dashboard.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/__tests__/admin-dashboard.test.tsx) | 30 | 0 |
| [src/components/piling/admin-dashboard.tsx](D:/PillingR/wt-codex-audits/src/components/piling/admin-dashboard.tsx) | 1 | 8 |
| [src/components/piling/admin-equipment/__tests__/equipment-maintenance-flag.test.ts](D:/PillingR/wt-codex-audits/src/components/piling/admin-equipment/__tests__/equipment-maintenance-flag.test.ts) | 22 | 0 |
| [src/components/piling/admin-equipment/detail/__tests__/equipment-monitoring.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/admin-equipment/detail/__tests__/equipment-monitoring.test.tsx) | 43 | 0 |
| [src/components/piling/admin-equipment/detail/equipment-monitoring.tsx](D:/PillingR/wt-codex-audits/src/components/piling/admin-equipment/detail/equipment-monitoring.tsx) | 6 | 8 |
| [src/components/piling/admin-users/__tests__/user-documents.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/admin-users/__tests__/user-documents.test.tsx) | 37 | 0 |
| [src/components/piling/admin-users/user-documents.tsx](D:/PillingR/wt-codex-audits/src/components/piling/admin-users/user-documents.tsx) | 5 | 1 |
| [src/components/piling/feedback-center.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/feedback-center.test.tsx) | 9 | 0 |
| [src/components/piling/feedback-center.tsx](D:/PillingR/wt-codex-audits/src/components/piling/feedback-center.tsx) | 3 | 0 |
| [src/components/piling/to/__tests__/to-panels-mobile-targets.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/to/__tests__/to-panels-mobile-targets.test.tsx) | 30 | 1 |
| [src/components/piling/to/__tests__/to-stats.test.ts](D:/PillingR/wt-codex-audits/src/components/piling/to/__tests__/to-stats.test.ts) | 15 | 0 |
| [src/components/piling/to/fuel-panel.tsx](D:/PillingR/wt-codex-audits/src/components/piling/to/fuel-panel.tsx) | 2 | 4 |
| [src/components/piling/to/meter-readings-panel.tsx](D:/PillingR/wt-codex-audits/src/components/piling/to/meter-readings-panel.tsx) | 3 | 5 |
| [src/components/piling/to/readiness/settings/__tests__/integrations-section.test.tsx](D:/PillingR/wt-codex-audits/src/components/piling/to/readiness/settings/__tests__/integrations-section.test.tsx) | 47 | 0 |
| [src/components/piling/to/readiness/settings/integrations-section.tsx](D:/PillingR/wt-codex-audits/src/components/piling/to/readiness/settings/integrations-section.tsx) | 4 | 3 |
| [src/core/observability/__tests__/health-tracker.test.ts](D:/PillingR/wt-codex-audits/src/core/observability/__tests__/health-tracker.test.ts) | 53 | 0 |
| [src/core/observability/health-tracker/checkers/schedulers.ts](D:/PillingR/wt-codex-audits/src/core/observability/health-tracker/checkers/schedulers.ts) | 1 | 0 |
| [src/core/observability/health-tracker/scheduler-registry.ts](D:/PillingR/wt-codex-audits/src/core/observability/health-tracker/scheduler-registry.ts) | 11 | 3 |
| [src/lib/__tests__/format.test.ts](D:/PillingR/wt-codex-audits/src/lib/__tests__/format.test.ts) | 27 | 2 |
| [src/lib/format.ts](D:/PillingR/wt-codex-audits/src/lib/format.ts) | 6 | 5 |
| [src/lib/maintenance-due.ts](D:/PillingR/wt-codex-audits/src/lib/maintenance-due.ts) | 7 | 6 |
| [src/modules/equipment/application/commands/__tests__/pm-scheduler.test.ts](D:/PillingR/wt-codex-audits/src/modules/equipment/application/commands/__tests__/pm-scheduler.test.ts) | 17 | 1 |
| [src/modules/equipment/application/commands/pm-scheduler.ts](D:/PillingR/wt-codex-audits/src/modules/equipment/application/commands/pm-scheduler.ts) | 10 | 1 |
| [src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts](D:/PillingR/wt-codex-audits/src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts) | 13 | 3 |
| [src/modules/equipment/application/queries/equipment-query.service.ts](D:/PillingR/wt-codex-audits/src/modules/equipment/application/queries/equipment-query.service.ts) | 6 | 1 |
| [src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts](D:/PillingR/wt-codex-audits/src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts) | 38 | 0 |
| [src/modules/inspections/application/commands/__tests__/template-commands.test.ts](D:/PillingR/wt-codex-audits/src/modules/inspections/application/commands/__tests__/template-commands.test.ts) | 73 | 4 |
| [src/modules/inspections/application/commands/inspection-commands.ts](D:/PillingR/wt-codex-audits/src/modules/inspections/application/commands/inspection-commands.ts) | 16 | 2 |
| [src/modules/inspections/application/commands/template-commands.ts](D:/PillingR/wt-codex-audits/src/modules/inspections/application/commands/template-commands.ts) | 17 | 5 |
| [src/modules/reports/application/projections/projection-worker.ts](D:/PillingR/wt-codex-audits/src/modules/reports/application/projections/projection-worker.ts) | 20 | 16 |
| [src/services/analytics/__tests__/equipment-analytics-service.test.ts](D:/PillingR/wt-codex-audits/src/services/analytics/__tests__/equipment-analytics-service.test.ts) | 18 | 0 |
| [src/services/analytics/equipment-analytics-service.ts](D:/PillingR/wt-codex-audits/src/services/analytics/equipment-analytics-service.ts) | 8 | 3 |
| [src/services/audit/__tests__/audit-service.test.ts](D:/PillingR/wt-codex-audits/src/services/audit/__tests__/audit-service.test.ts) | 24 | 0 |
| [src/services/audit/audit-service.ts](D:/PillingR/wt-codex-audits/src/services/audit/audit-service.ts) | 45 | 0 |
| [src/services/reports/outbox-publisher.ts](D:/PillingR/wt-codex-audits/src/services/reports/outbox-publisher.ts) | 11 | 5 |
| [src/workers/__tests__/outbox-worker.test.ts](D:/PillingR/wt-codex-audits/src/workers/__tests__/outbox-worker.test.ts) | 22 | 0 |
| [src/workers/__tests__/projection-worker.test.ts](D:/PillingR/wt-codex-audits/src/workers/__tests__/projection-worker.test.ts) | 65 | 0 |
| [src/workers/unified-worker/__tests__/pdf-cleanup-scheduler.test.ts](D:/PillingR/wt-codex-audits/src/workers/unified-worker/__tests__/pdf-cleanup-scheduler.test.ts) | 9 | 2 |
| [src/workers/unified-worker/pdf-cleanup-scheduler.ts](D:/PillingR/wt-codex-audits/src/workers/unified-worker/pdf-cleanup-scheduler.ts) | 7 | 1 |
