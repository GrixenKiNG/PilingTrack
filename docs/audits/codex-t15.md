# Поток 15 — результат

Рабочее дерево: `D:/PillingR/wt-codex15`. Ветка: `codex/audit-fixes-1010`.
База: `2161d62c65d501287c24f3018352788377cdd743`, текущий main на начало работы.
Задание: `D:/PillingR/codex-night/CODEX-THREAD-15.md`. Отчёты читались из `D:/PillingR/wt-night/docs/audits/hermes-night/`; ветка Hermes не переключалась и не вливалась.

Выполнены **12 логических исправлений**, каждое отдельным коммитом. Новых тестовых файлов нет. Отчёт фиксирует выбранные исправления, а не объявляет закрытыми все предложения аудита.

## Коммиты в порядке выполнения

| № | Коммит | Исправление | Регрессия до → после |
| --- | --- | --- | --- |
| 1 | `9d0953b7` | Y1: owner/main gate; runner собирает и проверяет SHA-образы; сервер принимает готовые образы и точный main | CJS exit 1 → exit 0, 33 offline-сценария; Vitest 9 passed / 3 failed → 12 passed |
| 2 | `212aa285` | Y2: удалены только finishShift/v2FinishShift, их типы и собственные тесты | 30 passed до удаления → 15 оставшихся passed; ровно 15 тестов удалённых функций убраны намеренно |
| 3 | `2857f29e` | AU153: HTML-экранирование полей DLQ Telegram | 8 passed / 1 failed → 9 passed |
| 4 | `d214c4d9` | AU153/AU149: длина видимого Telegram-текста ≤4096, без изменения сохранённого описания | 34 passed / 4 failed → 38 passed |
| 5 | `77e5532b` | AU135: общий бюджет PDF status/download по пользователю, 60/мин | 5 passed / 4 failed → 26 passed вместе с single-pdf |
| 6 | `75cbaa8b` | AU124: метраж бурения сохраняется без раннего округления в confirmed/pending строках | 15 passed / 2 failed, 50 вместо 49,98 → 17 passed |
| 7 | `2edd56ac` | AU124: итоги парка считаются по исходным значениям, затем округляются | 10 passed / 1 failed, 484 вместо 482 м и 4 вместо 2 ч/л → 11 passed |
| 8 | `86a48665` | AU126: атомарный переход отчёта из draft; повтор не меняет время, показания, историю/outbox | 12 passed / 4 failed → 16 passed |
| 9 | `9c8b5fca` | AU151: списанная установка исключена из планировщика ТО | 5 passed / 1 failed, создано ТО для списанной машины → 6 passed |
| 10 | `8e3a4f9a` | AU141: failed PDF возвращает ошибку, а не 202 «ещё не готов» | 11 passed / 1 failed → 29 passed вместе с single-pdf; waiting/active остаются 202 |
| 11 | `69771d53` | AU157: limit abc/0/−5/дробный/Infinity заменяется допустимым значением | 11 passed / 5 failed → 16 passed |
| 12 | `3d6a3321` | AU157: date + id задают полный порядок «моих отчётов» | 14 passed / 1 failed, 9 строк вместо 7 → 15 passed |

Все финальные focused-прогоны выполнены с конфигурацией без загрузки `.env`, с заглушками БД/сети. Совместный прогон четырёх data-файлов: exit 0, 50 passed / 0 skipped. Пагинация и queries совместно: exit 0, 31 passed / 0 skipped. Проверка PDF включает настоящий downloadPdf с подставленными BullMQ/Redis, а не только подставленное сообщение об ошибке.

## Задачи и отчёты — проверка по текущему коду

Исходные номера строк ниже относятся к базе `2161d62c`; после правок строки могли сдвинуться. Каждая строка таблицы соответствует одной задаче или одному отчёту в заданном порядке.

| Задача / отчёт | Статус и основание |
| --- | --- |
| Y1 | **Сделано.** deploy.yml ранее принимал предок origin/main и detached checkout (:90–91), собирал на VPS (:105–108), не ограничивал инициатора владельцем. Теперь owner + triggering_actor + main gate, точное соответствие свежему origin/main на runner и сервере, SHA build/smoke до первого SSH, передача готовых образов. Production reviewer требует настройки GitHub; локально её наличие не доказать. Actual-image rollback app/workers и WORKER_GENERATION_EXTERNAL_STOPPED=1 перед общим barrier сохранены. |
| Y2 | **Сделано.** Полный поиск нашёл только определения двух функций, их собственные тесты и ссылку мёртвого типа между моделями. Исторические упоминания в документах не являются вызовами. Общий nextStep, v2NextStep, живые действия FINISH_WORK/CLOSE_SHIFT и шаги смены сохранены. Файлы целиком не удалялись. |
| AU145 | **Неверна главная находка об утечке, потому что** reports.read_all/read_cross_user имеют одинаковые роли; ADMIN/DISPATCHER глобальны по решению владельца. Tenancy/auth изменения запрещены; новую модель доступа не вводили. |
| AU153 | **Сделано частично:** исправлены DLQ HTML (:102–104) и слишком длинное уведомление об инциденте. Обрезается только alert.message в форматтере до escaping; full DB/outbox payload, stop-work prefix и метаданные сохранены. Остальные предложения вне выбранного набора. |
| AU135 | **Сделано частично:** period PDF job GET (:222–230) получил бюджет до очереди/файла; смена UUID/action его не обходит, пользователи разделены. Общие изменения rate-limiter, мутационных ключей и Redis fail-open относятся к защищённым областям и не выполнялись. |
| AU161 | **Пропущена, потому что** fail-open denylist является явной текущей политикой; logout при отказе revocation уже отдаёт 503. Logout всех устройств — новая auth-функция в запрещённой области. |
| AU142 | **Пропущена частично, потому что** settings/crew уже используют effectiveRole; исторические actorName/actorRole фиксируются при записи, утверждение о чтении текущей роли неверно. Отдельные raw-role guards readiness/monitoring и audit UI остаются; их исправление не вошло в предел 12. |
| AU124 | **Сделано частично:** снято раннее округление use-report-form.ts:432,463; equipment-analytics-service.ts:204–208 суммирует исходные метры/часы/топливо. Плановые и фактические метры не обязаны совпадать. Остальные форматы/округление admin form не вошли в предел 12. |
| AU126 | **Сделано частично:** submitShiftReport использует updateMany с status=draft; недрафтовый повтор не пишет аудит/outbox. Существующий Shift FOR UPDATE сохранён. Другие предложения о статусах/повторном редактировании требуют правила процесса или не вошли в предел 12. Реальная PostgreSQL-конкурентность не запускалась. |
| AU130 | **Пропущена, потому что** предлагаемый отчётом maintenanceId закрытого осмотра не обозначает будущий ремонт: осмотр закрывается до создания дефекта. Закрытие дефекта при DONE/CANCELED и переход TRIAGE требуют решения процесса. FK не добавлялся без утверждённой модели; нарушения FK на данных не доказаны. |
| AU143 | **Неверна находка о неизбежном тупике, потому что** мобильный closeShift принимает незакрытую смену и закрывает её после ЕО. Правило владельца сохранено: одна дневная смена; вчерашнее дописывается до ручного закрытия; сегодняшнее — в новой смене. Новую ночную/автоматическую политику и уведомления не добавляли. |
| AU146 | **Пропущена, потому что** archivedAt отсутствует в DowntimeReason и потребует миграции и правила для исторических дат; SQL-черновик ниже. Auth/tenancy изменения запрещены. Возможное исключение NULL reasonId из Pareto найдено в SQL, но наличие таких строк не проверено; BREAK — бизнес-правило. |
| AU151 | **Сделано частично:** pm-scheduler.ts:61–76 теперь проверяет equipment.isActive. Исторические отчёты списанной техники сохраняются намеренно. Потенциальный DLQ readiness для неактивной установки отдельно не воспроизводился. |
| AU133 | **Пропущена, потому что** CRUD действительно не обновляет проекцию Equipment (:56–70,122,132), но неизвестно происхождение ручных порогов. При смене меры/удалении последнего плана нельзя угадывать, какой порог обнулить. Не вводили новую политику или схему; требуется решение владельца. |
| AU147 | **Пропущена, потому что** Redis exec CMD с буквальным $$REDIS_PASSWORD, app health и отсутствие PgBouncer healthcheck видны в compose, но Docker-файлы запрещены. Runtime-поведение не запускалось. HTTP liveness/readiness политика не менялась. |
| AU155 | **Пропущена, потому что** running сбрасывается в finally, но зависание/превышение BullMQ lock не измерено. Promise.race со снятием running способен создать параллельные незавершённые проходы. Новые queue metrics/таймауты — отдельная архитектурная работа. |
| AU163 | **Пропущена, потому что** отсутствие env_file само по себе не Critical — используется allowlist. Правки Docker/security/tenancy запрещены. Содержимое `.env*` по этим находкам не проверялось. |
| AU149 | **Сделано частично** через AU153: HTML и длина Telegram исправлены. У простоя уже есть лог отказа и best-effort политика, утверждение о полной бесследности неверно. PM alert false, новый резервный канал/повторы не вошли в предел 12. Превышение proxy timeout не измерено. |
| AU141 | **Сделано частично:** failed download больше не маскируется как not-ready/202. Кеш начального отказа Redis остаётся (предел 12); общее PDF-хранилище worker/app требует запрещённой Docker/config работы. Production S3/volume не проверялись. |
| AU131 | **Неверна находка №4, потому что** cleanup уже вызывает flushSafely до clearTimers (:346–348). **Остальное пропущено:** reportId в черновике отсутствует, но не вошёл в предел 12; общая auth/401 политика запрещена, новые черновики других форм не добавлялись. |
| AU157 | **Сделано частично:** NaN/неположительный take (:46) устранён; listReportsForUserScope (:300–303) получил id tie-breaker. Пагинация остальных больших экранов и tenant map оптимизации не вошли в предел 12. |
| AU158 | **Пропущена, потому что** ссылки users/dictionaries без UI gate найдены, но окончательная проверка текущих pageguard не завершена; неподтверждённое исправление не выбирали. Новую навигационную политику и роли без пользователей не меняли. |
| AU132 | **Неверна находка Node drift, потому что** CI/Docker уже используют Node 22; deploy permissions уже заданы. **Остальное пропущено:** integration PG16 против CI/compose PG18 остаётся, но не вошло в предел 12; настоящий workflow не запускался. |

### AU146 — нужен выбор модели и миграция, черновик не исполнялся

В текущей схеме таблица называется `DowntimeReason`, поля времени используют timestamptz(3). Если владелец подтвердит сохранение даты архивации:

```sql
BEGIN;
ALTER TABLE "DowntimeReason" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
COMMIT;
```

Это только добавление nullable-колонки. Даты ранее отключённых причин не угадывать по updatedAt; исторический backfill и допуск отложенных записей требуют отдельного правила. Prisma schema/migrations и БД не менялись. Миграция и применение SQL не выполнялись.

## GitNexus и текстовая замена

Два CLI impact из рабочего дерева (Node 26.7.0 и 24.19.0) завершились exit 1: native @ladybugdb/core не установился, `spawnSync ... cmd.exe ENOENT`. Графа нет. **Риск всех изменений UNKNOWN, не LOW.** Пользователь отдельно разрешил для потока 15 заменить обязательные impact/detect_changes полным текстовым поиском и проверкой diff.

Перед правками проверялись определения, импорты, реэкспорты и вызовы по src/e2e/tests/scripts/prisma/config/.github; `.env*`, generated, node_modules и GitNexus cache исключались. Перед коммитами проверялись diff и `git diff --check`, затем весь diff относительно базы. Текстовые трассы: moveToDlq → outbox; buildAlertMessage → notifier/durable alert delivery; useReportForm → ReportForm; submitShiftReport → closeShift/submitReport; PM → unified scheduler; analytics → equipment analytics API; parseCursorPagination → users/equipment/sites/crews/reports-my; user scope → reports-my; downloadPdf → period/single PDF. Это текстовая проверка, не графовое доказательство.

Y2 дополнительно искался по всему репозиторию с `rg --hidden` и исключением секретных/генерируемых каталогов. Найдены определения/собственные тесты и исторические docs. Поиск путей моделей подтвердил сохранённые named imports nextStep/NextStep. Удалены экспорты finishShift, v2FinishShift, FinishShiftAction, FinishShift; ни одного целого файла не удалено.

Логи и безопасные конфигурации находятся в игнорируемом `output/codex-t15/`: GitNexus, text-impact-final.log, unit-final.log, playwright-final.log, vitest.no-env.config.ts и prisma-generate.config.ts.

## Проверки и ограничения

| Команда / проверка | Exit | Результат |
| --- | --- | --- |
| `npx prisma generate --config output/codex-t15/prisma-generate.config.ts` | 0 | Текущий Client 7.10.0 сгенерирован из схемы; без datasource/env и без БД |
| Проверка `.next/dev/types` | 0 | Каталог отсутствовал. Первичная команда удаления была отклонена автоматической политикой и не исполнялась; безопасная проверка показала, что удалять нечего |
| `npx tsc --noEmit` | 0 | Ошибок нет; полноценная Next-сборка отдельно не подтверждена |
| `npx eslint --max-warnings 0` по изменённым TS/TSX | 0 | Ошибок и предупреждений нет |
| `npm run lint` | 0 | ESLint и text integrity прошли |
| Полный `npm run test:unit -- --config output/codex-t15/vitest.no-env.config.ts --maxWorkers=1 --testTimeout=15000` | 0 | 391 files passed / 13 skipped; 4168 passed / 2 expected fail / 257 skipped, всего 4427; 1176,85 с |
| `npx playwright test --list` | 0 | 291 тест / 27 файлов до и после; это сбор списка, не запуск e2e |
| `node scripts/test-deploy-workflow.cjs` | 0 | 33 offline-сценария; настоящих SSH/Docker/deploy нет |
| YAML + `bash -n` | 0 | 11 Bash-блоков, включая 2 remote heredoc; actionlint не установлен |
| `node --check scripts/test-deploy-workflow.cjs` | 0 | Синтаксис CJS корректен |
| `npm run build` — изолированная проверка начального шага без env | 1 | Только package/tsconfig/validate-env скопированы во временный каталог; validator остановил команду: отсутствуют DATABASE_PROVIDER и SESSION_SECRET. Prisma/Next build не запускались. Временный каталог и junction удалены |
| `git diff 2161d62c` по schema/migrations/auth/security/rate-limiter/Docker/deploy-prod | 0 | Пусто; эти области не изменены |
| `git diff --check` | 0 | Выполнялся для каждого исправления |

Стандартный focused Vitest первоначально автоматически загрузил `.env` через repo-config; это ошибка процесса, ручного чтения или вывода значений не было. Эти проверки использовали mocked DB. Затем конфигурация заменена на копию без dotenv/helper, с `envDir:false`, `env:{}`, теми же plugins/setup/include и alias на src. **Все финальные проверки тестов повторены без загрузки `.env`.** DB/Redis URL очищались только в дочернем процессе; файлы окружения не менялись. Для integration imports dotenv/config задавался DOTENV_CONFIG_PATH на отсутствующий файл.

Y1 default focused timeout дал 11 passed / 1 timeout в старом smoke-тесте (sleep 4 секунды + Windows Bash startup); повтор с явным 15000 мс дал 12 passed. Порог smoke-скрипта не менялся. ESLint CJS по обычной конфигурации исключён: paired запуск дал exit 1 из-за ignored-file warning; принудительный `--no-ignore` дал exit 1, 6 ошибок запрета require() для CJS. Это не выдаётся за зелёный lint CJS. TS и полный настроенный lint зелёные. Vite предупреждает о будущем config loader; полный single-worker прогон также вывел MaxListenersExceededWarning. Предупреждения не подавлялись и источник вне выбранных правок не менялся.

Для воспроизведения safe Vitest-конфигурации: скопировать vitest.config.ts в output/codex-t15/vitest.no-env.config.ts; удалить fs/dotenv imports, DB_ENV_KEYS и dbEnvFromDotenv; заменить test.env на {}; добавить envDir:false; alias должен указывать на `D:/PillingR/wt-codex15/src` (для nested-конфига путь `../../src`). Остальные настройки оставить прежними. Для generate-конфига оставить только defineConfig({schema: абсолютный путь prisma/schema.prisma}), без dotenv/datasource.

Перед тестами в дочернем PowerShell:

```powershell
$env:DATABASE_URL=$null
$env:DATABASE_URL_POSTGRES=$null
$env:DATABASE_URL_APP_ROLE=$null
$env:REDIS_URL=$null
$env:DOTENV_CONFIG_PATH='D:/PillingR/wt-codex15/output/codex-t15/no-settings-file'
```

Это отключение загрузки окружения, не подстановка выдуманных application settings. Интеграции, которым нужна БД, должны честно пропускаться. Реальные PostgreSQL, Redis, Telegram, S3, worker images и deploy в этом потоке не проверялись.

## Y1 — что владельцу настроить до пробного запуска

Repository variable `PROD_DEPLOY_OWNER`: точный логин владельца. Environment `production`: обязательный reviewer-владелец, admin bypass выключен, только branch main, без tags. Для владельца, который и запускает, и согласует, Prevent self-review оставить выключенным; иначе нужен второй согласующий. Проверить доступность environment protection в текущем плане/видимости репозитория; без неё workflow не активировать. [Документация GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Environment secrets: **PROD_SSH_KEY** и **PROD_SSH_KNOWN_HOSTS**. Host key получить и сверить через доверенный канал, а не доверять первому ssh-keyscan. GH_TOKEN берётся из github.token; отдельный секрет не нужен. Workflow требует ручного dispatch, подтверждения остановки внешних workers, успешного последнего push CI именно для текущего полного SHA main. GitHub настройки, ключи и реальный прогон не создавались/не проверялись. Всегда заменяются app+workers вместе; migrate-image всегда доставляется свежим. Резервные теги сохраняют actual running app/workers image IDs; реальный rollback БД не проверен. Детали в runbook 007.

## Изменённые файлы

Пути относительно D:/PillingR/wt-codex15; +/− относительно базы. До добавления этого отчёта: 27 файлов, +620/−285. Удалений целых файлов нет.

| Файл | + | − |
| --- | ---: | ---: |
| `.github/workflows/deploy.yml` | 71 | 55 |
| `docs/runbooks/007-github-actions-deploy.md` | 41 | 17 |
| `scripts/test-deploy-workflow.cjs` | 136 | 30 |
| `src/app/api/reports/pdf/__tests__/route.test.ts` | 80 | 2 |
| `src/app/api/reports/pdf/route.ts` | 16 | 0 |
| `src/components/piling/operator-mobile/__tests__/shift-next-step.test.ts` | 1 | 29 |
| `src/components/piling/operator-mobile/shift-next-step.ts` | 1 | 41 |
| `src/components/piling/operator-v2/__tests__/step-bar-model.test.ts` | 1 | 24 |
| `src/components/piling/operator-v2/step-bar-model.ts` | 1 | 21 |
| `src/components/piling/report-form/__tests__/use-report-form.length.test.ts` | 25 | 0 |
| `src/components/piling/report-form/use-report-form.ts` | 2 | 2 |
| `src/core/notifications/__tests__/telegram.test.ts` | 36 | 0 |
| `src/core/notifications/telegram.ts` | 15 | 3 |
| `src/core/outbox/__tests__/dead-letter-queue.test.ts` | 29 | 0 |
| `src/core/outbox/dead-letter-queue.ts` | 7 | 3 |
| `src/lib/__tests__/pagination.test.ts` | 14 | 0 |
| `src/lib/pagination-cursor.ts` | 3 | 1 |
| `src/lib/pdf-queue.ts` | 2 | 0 |
| `src/modules/equipment/application/commands/__tests__/pm-scheduler.test.ts` | 14 | 0 |
| `src/modules/equipment/application/commands/pm-scheduler.ts` | 1 | 1 |
| `src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts` | 58 | 21 |
| `src/modules/operator-mobile/application/commands/shift-close.ts` | 6 | 5 |
| `src/modules/reports/application/queries/__tests__/report-query.service.test.ts` | 23 | 0 |
| `src/modules/reports/application/queries/report-query.service.ts` | 1 | 1 |
| `src/services/analytics/__tests__/equipment-analytics-service.test.ts` | 16 | 0 |
| `src/services/analytics/equipment-analytics-service.ts` | 4 | 4 |
| `src/workers/__tests__/workers-image-smoke.test.ts` | 16 | 25 |

## Что сохранено и что осталось

Авторизация/tenancy/RLS, Docker, deploy-prod, schema/migrations, ORION, роли без пользователей, C6 и чужие ветки не изменены. Экраны оператора затронуты только в пределах прямого разрешения потока 15 и с тестами. Ручные пороги ТО и правило дневной смены не переопределялись. Новых зависимостей и версий нет. Push, merge, SSH и выкладка не выполнялись.

Открыто: AU133 требует правила ручных/рассчитанных порогов; AU146 — решения и миграции; Docker/security находки имеют запрет области; остальные подтверждённые пункты сверх выбранных 12 перечислены выше. Реальную Next-сборку и эксплуатационные проверки должен выполнить согласованный контур с окружением. Graph risk UNKNOWN остаётся нерешённым риском, несмотря на разрешённую замену.
