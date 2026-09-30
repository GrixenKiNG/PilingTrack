# R78 — Кандидаты в мёртвый код после удаления ws-сервера

Только чтение: ничего не удалялось и не менялось. Повод — удаление WebSocket-сервера
(коммит `a8567732`, 26.09.2026) и последующие ночные правки (85 коммитов ветки
`hermes/q4-0926` над `origin/main`); задача — найти осиротевшие файлы, экспорты,
маршруты и переменные окружения.

## Итог

- **критично — 0**, **важно — 17**, **мелочь — 33** (всего 50 пронумерованных находок; остаток —
  списком в приложениях).
- **18 файлов `src/**` недостижимы** ни из одной точки входа (страницы/routes/instrumentation/тесты/
  package.json/скрипты). Из них 3 — мёртвый «остров» Radix-toast, 11 — неиспользуемые
  barrel-фасады, 4 — самостоятельные файлы (hook, сид-заготовка, набор доменных типов, файл
  отчётов-типов).
- **107 экспортов не имеют ни одной ссылки во всём репозитории** (в т.ч. в своём файле) — цифра
  совпадает с прошлым аудитом `05-dead-code-inventory.md` (там 109); ещё **76 экспортов** живут
  только тестам, **334** — «лишний `export`» (ключевое слово избыточно).
- **6 маршрутов `src/app/api/**` не вызываются никем** (ни клиентом, ни скриптом, ни мониторингом);
  ещё 4 живут только на внешних потребителях (Prometheus/смоук/CI), 5 — ложные срабатывания из-за
  URL, собранного из переменной-сегмента.
- **Хвостов удаления ws в `src/` нет** — ни одного битого импорта, ни одного обращения к
  `@/core/realtime`. Остались только текстовые следы: `load-tests/slo-monitor.ts:326`,
  `scripts/validate-env.ts:107`, `setup.sh:4,54,112`, устаревший индекс `.gitnexus`.
- **Топ-5 самых надёжных кандидатов:** мёртвый остров `ui/toaster.tsx` + `ui/toast.tsx` +
  `lib/hooks/use-toast.ts`; `components/piling/admin-reports/index.tsx` (barrel) и `types.ts`;
  `lib/seed/equipment.seed.ts`; `lib/hooks/use-mobile.ts`; шесть неиспользуемых barrel-фасадов
  (`core/{storage,notifications,error-boundary,application,security}/index.ts`, `services/reports/index.ts`).
- **Важное не про удаление:** индекс GitNexus (`.gitnexus/meta.json`) построен на коммите
  `f45375f3` (26.09.2026 14:44) — **до** удаления ws (`a8567732`, 20:39). `impact`/`detect_changes`
  всё ещё знают удалённые файлы `src/core/realtime/**` и `Dockerfile.ws`, то есть анализ влияния,
  предписанный AGENTS.md, сейчас отвечает по несуществующему коду.

## Методика

Всё воспроизводимо; репозиторий не менялся, `.env*` не открывались (только `*.example`).

1. **Граф импортов.** Node-скрипт обошёл `src/**` (1213 .ts/.tsx без `src/generated`) плюс
   `scripts/ e2e/ tests/ load-tests/ deploy/ observability/ prisma/ agents/ prisma.config.ts
   next.config.ts vitest.config.ts playwright.config.ts`; собрал специфаеры регулярками
   `from '...'`, `import '...'`, `import('...')`, `require('...')`; разрешал `@/` → `src/` и
   относительные пути с расширениями `.ts/.tsx/.js` и `index.*`. Результат: для каждого файла —
   список импортёров.
2. **Достижимость (главный тест).** Обход в глубину от «корней»: `src/app/**/{page,layout,route,
   loading,error,not-found,global-error,template,default}.tsx|ts`, `src/app/sitemap.ts`,
   `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/proxy.ts`, `src/test/setup.ts`,
   все `*.test.*`/`__tests__`, а также любой файл, чей путь встречается строкой в
   `package.json`, `docker-compose*.yml`, `Dockerfile*`, `Caddyfile.prod`, `setup.sh` и внутри
   `scripts/ e2e/ tests/ prisma/ .github/ observability/ deploy/ load-tests/`. Файлы, до которых
   обход не добрался, — кандидаты «файл без импортёров». Так корректно исключаются
   `src/workers/{outbox,projection,pdf}-worker.ts` (живут через `npm run worker:*`) и
   `src/test/setup.ts` (через `vitest.config.ts`).
3. **Экспорты.** По AST-подобной регулярке собраны `export function|const|class|interface|type|enum`
   и групповые `export {…}` по всем файлам `src/**`. Имя каждого экспорта искалось как `\bNAME\b`
   по всем текстовым файлам репозитория (кроме `node_modules`, `.next`, `.git`, `.gitnexus`,
   `src/generated` и `*.md` — документация потребителем не считается). Классификация:
   «мёртв» = единственное вхождение — объявление; «только тест» = вне тестов вхождений нет;
   «файл-только» = используется лишь в своём файле. Исключены конвенции Next (`GET/POST/PUT/PATCH/
   DELETE` в `route.ts`, `dynamic`, `revalidate`, `runtime`, `metadata`, `config`…).
4. **Маршруты API.** Из пути файла строился URL (`src/app/api/x/[id]/route.ts` → `/api/x/[id]`),
   сегменты `[id]` заменялись на `[^'"`\s)]+`, и URL искался во всех текстовых файлах кода и
   инфраструктуры (без `docs/`, `.claude/`, `.gitnexus/`). Потребители делились на «клиентские»
   (`src/components|lib|app` вне `api`), «инфраструктурные» (`scripts/deploy/observability/chaos/
   .github/compose/Dockerfile`), «тестовые». Отдельно вручную проверены маршруты, у которых
   последний сегмент URL собирается из переменной.
5. **Переменные окружения.** `process.env.NAME` / `process.env['NAME']` по `src/ scripts/ e2e/
   tests/ prisma/ agents/ load-tests/ deploy/ observability/` — 107 имён; сверка с
   `.env*.example`, `docker-compose*.yml`, `Dockerfile*`, `scripts/validate-env.ts` и
   `deploy/**` (совместно с прошлым аудитом `R61-env-vars.md`).
6. **Проверка динамики.** Искались все способы «вызова по имени»: `next/dynamic` и `React.lazy`
   (не найдено ни одного), вычисляемый `import(...)` (6 файлов, все — литеральные пути),
   строки `/api/…` (в т.ч. шаблонные), `scripts/add-runtime.js` со списком route-файлов,
   `scripts/.layer-boundaries-baseline.txt`, `package.json` scripts, `docker-compose*.yml`,
   `vite`/`playwright` конфиги, `.github/workflows`.

Ключевые команды (сокращённо):
```
node <скрипт-графа-импортов>      # файлы без импортёров + импортёры
node <скрипт-достижимости>        # обход от корней
node <скрипт-экспортов>           # 107 мёртвых / 76 тест-онли / 334 файл-только
node <скрипт-потребителей-API>    # 140 маршрутов: клиент / инфра / тест
grep -rn "next/dynamic\|React.lazy\|lazy(" src
grep -rni "websocket\|realtime" src scripts load-tests setup.sh
```

## Находки

Уверенность: **высокая** — имя/файл не найден ни в одном потребителе и не может быть получен
динамически (нет `next/dynamic`, нет вычисляемого `import()`, нет строкового пути);
**средняя** — найден только косвенный потребитель (baseline, тест, legacy-шим) либо удаление
задевает отчёт/документацию; **низкая** — есть документированное намерение сохранить.

### A. Файлы `src/**` без импортёров (достижимость подтверждена обходом от корней)

| # | severity | уверенность | path:line | проблема | сценарий / почему важно | предлагаемое действие |
|---|---|---|---|---|---|---|
| 1 | важно | высокая | `src/components/ui/toaster.tsx:13` | `Toaster` (Radix) не импортируется нигде | В `src/app/layout.tsx:6,116` смонтирован `<Toaster/>` из **sonner**; Radix-тостер вытеснен, но остался в дереве импортов | Удалить вместе с двумя зависимостями ниже |
| 2 | важно | высокая | `src/lib/hooks/use-toast.ts:195` | `useToast`/`toast` вызываются только из `ui/toaster.tsx` | Файл жив только потому, что мёртвый toaster его импортирует | Удалить вместе с п.1 |
| 3 | важно | высокая | `src/components/ui/toast.tsx:1` | примитивы Radix-toast (119 экспортов-строк) импортируются только из п.1 и п.2 | Замыкание из трёх файлов ничем не связано с приложением | Удалить вместе с п.1–2 |
| 4 | важно | высокая | `src/components/piling/admin-reports/index.tsx:3` | barrel `export { AdminReports } from './admin-reports'` никем не читается | Живой потребитель идёт напрямую: `src/components/piling/admin-reports/reports-module.tsx:8` и `src/app/(app)/admin/reports/page.tsx:4` импортируют `./admin-reports` и `./reports-module` | Удалить файл |
| 5 | важно | высокая | `src/components/piling/admin-reports/types.ts:12,23` | `PeriodSummary` и `ReportWithDetails` не используются нигде | Файл целиком мёртв: других экспортов в нём нет | Удалить файл (перед этим `grep -rn "admin-reports/types"`) |
| 6 | мелочь | высокая | `src/core/storage/index.ts:4` | barrel S3-хелперов (`generateUploadUrl`, `uploadBuffer`, …) не импортируется | Потребители берут `./s3-service` напрямую | Удалить либо оставить как публичный фасад (решение владельца) |
| 7 | мелочь | высокая | `src/core/notifications/index.ts:4` | barrel `telegramNotifier` не импортируется | То же — прямые импорты `./telegram` | см. п.6 |
| 8 | мелочь | высокая | `src/core/error-boundary/index.ts:1` | barrel `withErrorBoundary`/`Bulkhead`/… не импортируется | Реальный `withErrorBoundary` живёт в `./api-error-boundary` (`src/components/piling/app-error-boundary.tsx` импортирует напрямую) | см. п.6 |
| 9 | мелочь | высокая | `src/core/application/index.ts:5` | barrel (`withCsrf`, `rateLimiter`, tenancy-фасад) не импортируется кодом | Единственная «ссылка» — строка в `scripts/.layer-boundaries-baseline.txt:2`; удаление файла без правки baseline сломает `npm run check:layers` | Если удалять — убрать строку из baseline и прогнать `check:layers` |
| 10 | мелочь | низкая | `src/core/security/index.ts:9` | barrel tenancy/idempotency не импортируется | Файл в off-limits зоне (`src/core/security/**`, AGENTS.md §1) — только для сведения | Не трогать без решения владельца |
| 11 | мелочь | высокая | `src/lib/hooks/use-mobile.ts:5` | `useIsMobile` не используется | Адаптив делается через CSS/Tailwind, hook не нужен | Удалить |
| 12 | мелочь | высокая | `src/lib/seed/equipment.seed.ts:74` | `seedEquipment` вызывается только из самого себя | Сид-заготовка «для разработки»; `prisma/seed.ts` её не импортирует | Удалить (проверить, что `prisma/seed.ts` не ссылается строкой) |
| 13 | мелочь | высокая | `src/modules/crews/application/commands/index.ts:1` | barrel модуля экипажей не импортируется (2 строки) | Потребители берут `crew-command.service` напрямую | Удалить |
| 14 | мелочь | высокая | `src/modules/crews/application/queries/index.ts:1` | то же для queries | | Удалить |
| 15 | мелочь | высокая | `src/modules/equipment/application/commands/index.ts:1` | то же для оборудования | | Удалить |
| 16 | мелочь | высокая | `src/modules/equipment/application/queries/index.ts:1` | то же (1 строка) | | Удалить |
| 17 | мелочь | высокая | `src/services/reports/index.ts:1` | фасад `@deprecated … will be removed in the next major version` — потребителей нет | Файл сам себя называет устаревшим; это подтверждает вывод | Удалить вместе с упоминаниями в docs (отдельным шагом) |
| 18 | мелочь | высокая | `src/core/shared/types/event-contracts.ts:256` | файл целых доменных контрактов событий; живой экспорт — только `TypedEnvelope`, и он мёртв | 256 строк типов не читает ни один файл (кроме самого себя) | Проверить и удалить |

**Не кандидаты (исключения владельца), но тоже недостижимы — зафиксировано, чтобы их не «нашли заново»:**
`src/components/piling/operator-dashboard.tsx`, `src/components/piling/operator-document-reminder.tsx`
(импортируется только из operator-dashboard), `src/components/piling/operator/{handover-dialog,
meter-reading-dialog,shift-step-card,shift-task-screen}.tsx` — это связный замороженный остров
«путь отката экрана оператора» (AGENTS.md §4); `src/modules/telemetry/index.ts` — телеметрия
(dormant по решению владельца).

### B. Экспорты без потребителей — топ-20 (полный список 107 — в приложении B1)

| # | severity | уверенность | path:line | проблема | сценарий / почему важно | предлагаемое действие |
|---|---|---|---|---|---|---|
| 19 | важно | высокая | `src/modules/readiness/domain/readiness-rules.ts:106` | `isSystemSafetyBlocker` не вызывается | Правило системного safety-блокера не применяется в расчёте готовности (дубль вывода `05-dead-code-inventory`) | Проверить, что блокер реализован иным путём; иначе подключить |
| 20 | важно | высокая | `src/modules/readiness/infrastructure/audit/verify-chain.ts:81` | `verifyTenantAuditChain` не вызывается | Цепочку аудита проверяет только `verifyAuditEvents` (из `src/app/api/readiness/audit/route.ts:5`); «проверка всей цепочки арендатора» недоступна ниоткуда | Подключить к админ-диагностике или удалить |
| 21 | важно | высокая | `src/modules/readiness/application/command-pipeline/etag.ts:60` | `assertCurrentVersion` заброшен | Оптимистичная блокировка по ETag на этом пути не исполняется (дубль `05`) | Убедиться, что версия проверяется в `execute-command.ts`; иначе удалить |
| 22 | важно | высокая | `src/lib/cache-strategies.ts:75,79,200,406,415,426` | `getCacheStats`/`resetCacheStats`/`writeThroughBulk`/`defaultCache`/`lowLatencyCache`/`consistentCache` не используются | Готовые кеш-конфигурации и статистика не подключены — наблюдаемости кеша нет | Подключить или удалить |
| 23 | важно | высокая | `src/lib/cache-metrics.ts:42,47,52,57,61,70,137` | 7 функций учёта метрик кеша и `createMetricsResponse` мертвы | Подсистема метрик кеша не вызывается ни из слоя кеша, ни из `/api/metrics` | То же |
| 24 | важно | высокая | `src/lib/request-context.ts:48,63,70,104` | `getCurrentTrace`/`getSpanId`/`getRequestIdFromContext`/`attachTraceHeaders` мертвы | Корреляционный контекст (trace/span) не прошивается в логи | Подключить к `logger`/`withApi` или удалить |
| 25 | важно | высокая | `src/core/observability/lag-monitor.ts:352,360` | `getLagAlerts`/`getFreshLagMetrics` не вызываются | Метрика лага воркеров не читается ни API, ни Grafana-панелью (см. R56) | Подключить к `/api/metrics` или удалить |
| 26 | важно | высокая | `src/lib/api.ts:186,190,197` | `authGet`/`authPost`/`authPut` мертвы | Клиент дублирует обёртки самописно (250 вызовов `authFetch`), три готовые — не используются | Удалить или свести к одной реализации |
| 27 | мелочь | высокая | `src/modules/readiness/domain/readiness-score.ts:235` | `readinessTone` не вызывается | Подсветка тона оценки не применяется | Подключить или удалить |
| 28 | мелочь | высокая | `src/lib/types.ts:82,87,152,392,456,487` | 6 DTO запросов (`LoginPayload`, `AuthResponse`, `Create*Payload`) не используются | Схемы переехали в `validation-schemas`, типы остались | Удалить |
| 29 | мелочь | высокая | `src/lib/validation-schemas.ts` (24 шт.) | 24 zod-схемы/типа без потребителя: `:18,58,198,228,328,362,378,386,433,450–465` | Вытеснены схемами в route-файлах | Удалить, оставив живые внутренние (`uuidSchema`, `reportQuerySchema`…) |
| 30 | мелочь | высокая | `src/modules/readiness/domain/shifts/types.ts:19,32` | `ShiftRecord`/`ShiftHandoverRecord` не используются | Доменные типы смен не подключены | Удалить |
| 31 | мелочь | высокая | `src/modules/operator-mobile/domain/hazard-classification.ts:49,52,55,100` | `isHazardSeverity`/`isSafetyIncidentState`/`isObservedHazardSign`/`SafetyIncidentSummary` мертвы | Правила классификации опасности не применяются (зона `operator-mobile` объявлена замороженной — согласовать) | Уточнить у владельца |
| 32 | мелочь | высокая | `src/modules/operator-mobile/domain/ppe.ts:45` | `ppeConfirmedFor` не вызывается | Подтверждение СИЗ не проверяется | То же |
| 33 | мелочь | высокая | `src/modules/operator-mobile/domain/work-warnings.ts:272` | `hasAlerts` не вызывается | | То же |
| 34 | мелочь | высокая | `src/components/piling/to/to-module-bits.tsx:22,106,176,186` | `overdueLabel`/`TabButton`/`ChecklistBlock`/`InfoLine` | Вспомогательные UI-компоненты ТО не используются | Удалить |
| 35 | мелочь | высокая | `src/components/piling/to/readiness-design-views.tsx:149,258,319,379,460,522` | 6 черновых `Readiness*View` | Похоже на референс-наброски (аналогично ORION-концептам) | Уточнить у владельца |
| 36 | мелочь | высокая | `src/components/piling/admin-equipment/equipment-dialogs.tsx:162`, `equipment-card-template.ts:124` | `DeleteEquipmentDialog`, `cloneEquipmentCardTemplate` | Удаление оборудования идёт другим путём | Проверить и удалить |
| 37 | мелочь | высокая | `src/components/piling/analytics-dashboard/kpi-catalog.ts:46,50`, `monitoring/equipment-tile-template.ts:18,20` | `ANALYTICS_KPI_WIDGET_IDS`, `analyticsWidgetIdsByZone`, `EQUIPMENT_TILE_COLUMNS`, `EquipmentTileBlockKind` | Каталоги/типы шаблонов не применяются | Удалить |
| 38 | мелочь | высокая | `src/components/piling/to/readiness/api/idempotency.ts:2,15`, `readiness-labels.ts:32` | `READINESS_IDEMPOTENCY_KEY_HEADER`, `createReadinessIdempotencyKey`, `HANDOVER_STATE_LABEL` | Идемпотентность клиента готовности и ярлык передачи смены не подключены | Удалить или подключить |

Прочие мёртвые экспорты (пути и строки) — приложение B1.

### C. Маршруты `src/app/api/**` без клиента и без внешних потребителей

Отдельно проверено, что «нет потребителя» не объясняется сборкой URL из переменной:
`defects-panel.tsx:125`, `permits-screen.tsx:123`, `shifts-screen.tsx:131`, `operator-dashboard.tsx:285`
собирают путь как `/api/readiness/<сущность>/${id}/${action}`. Из-за этого шаблона ложными
кандидатами оказались `/api/readiness/defects/[id]/{triage,resolve,reject}`,
`/api/readiness/shifts/[id]/decline`, `/api/readiness/work-permits/[id]/revoke` — они **вызываются**
(наборы действий перечислены в типах: `defects-panel.tsx:41`, `permits-screen.tsx:56`,
`shifts-screen.tsx:41`). Аналогично `/api/reports/[id]/history` вызывается из
`src/components/piling/admin-reports/use-report-history.ts:23` (через `encodeURIComponent`), а
`/api/readiness` (без хвоста) — устаревший алиас с заголовком `Sunset: Wed, 30 Sep 2026 21:00:00 GMT`
(`src/app/api/readiness/route.ts`), который ещё прописан в `src/proxy.ts:120` и в e2e-смоуке.

| # | severity | уверенность | path:line | проблема | сценарий / почему важно | предлагаемое действие |
|---|---|---|---|---|---|---|
| 39 | важно | высокая | `src/app/api/readiness/shifts/[id]/waiver/route.ts:15` | POST-маршрут разрешения диспетчера на пуск заблокированной машины не вызывается ниоткуда | `waiveShiftStartCommand` (`src/modules/readiness/application/shifts/commands.ts:238`) существует и покрыт контрактным тестом, но UI его не зовёт (`shifts-screen.tsx:41` знает только `request-acceptance \| start \| handover \| decline`). Значит блокировку пуска снять в принципе нельзя — это не мёртвый код, а **незакрытый функционал** | Подключить кнопку разрешения в экране смен либо признать функцию ненужной |
| 40 | важно | высокая | `src/app/api/readiness/shifts/[id]/cancel/route.ts:11` | POST отмены смены не вызывается | То же: `cancelShiftCommand` (`…/shifts/commands.ts:303`) недостижим; «Отказать» — это `decline`, отдельной отмены в UI нет | Подключить или удалить вместе с командой |
| 41 | важно | высокая | `src/app/api/briefings/[id]/sign/route.ts:19` | POST подписи записи журнала инструктажей не вызывается | `signBriefingRecord` (`src/modules/safety/index.ts:21` → `application/briefing-commands.ts:114`) не зовётся ни из одного экрана: `briefings-screen.tsx` только показывает `employeeSignedAt`/`instructorSignedAt`. Подпись в журнале поставить негде | Подключить действие подписи или удалить маршрут и команду |
| 42 | важно | средняя | `src/app/api/maintenance-plans/run/route.ts:13` | ручной триггер планировщика ТО не вызывается | Комментарий `:11–12` обещает «run it on demand from the UI», но UI нет; сам `runPmScheduler` жив — его вызывает воркер (`src/workers/unified-worker/pm-scheduler.ts:12`). Дублирует `POST /api/maintenance-plans` | Удалить маршрут либо вывести кнопку в админке |
| 43 | мелочь | средняя | `src/app/api/monitoring/template/route.ts:17,25` | GET/PUT шаблона плитки мониторинга не вызывается | Файл сам себя документирует (`src/modules/monitoring/application/template-service.ts:1–6`) как legacy-шим, пока клиенты не перешли на `/api/layout/[surfaceId]`. Переход не состоялся: `/api/layout/[surfaceId]` вызывается (`use-layout-template.ts`), а этот маршрут — нет | Либо дочистить, либо оставить осознанно (решение владельца) |
| 44 | мелочь | средняя | `src/app/api/system/status/route.ts:22` | админ-диагностика `/api/system/status` не вызывается из UI | Ссылки есть только в комментариях и тестах (`src/app/api/health/deep/route.ts:13`, `tests/chaos/circuit-breaker.test.js:207`). Данные при этом собираются: `getCurrentStatus`/`getFreshStatus` используются `/api/health/deep` и `/api/metrics` | Оставить как диагностический маршрут либо подключить ссылку из админки |
| 45 | мелочь | низкая | `src/app/api/equipment/[id]/device-keys/route.ts:1` | провижининг ключей устройств: клиента нет вообще (ни UI, ни скрипта) | Маршрут относится к телеметрическому контуру (dormant по решению владельца) — вероятно и его надо считать «живым при подключении железа» | Согласовать с телеметрией |

Инфраструктурные потребители (не кандидаты, но зафиксировано): `/api/alerts/webhook` —
`observability/alertmanager/alertmanager.yml`, `observability/prometheus/alerts.yml`,
`docker-compose.yml`, `scripts/disk-guard.sh`, `scripts/app-guard.sh`; `/api/liveness` —
`.github/workflows/ci.yml`; `/api/admin/projections/rebuild` — `scripts/backfill-projections.ts`;
`/api/system` — `scripts/smoke-auth-access.js`. `/api/telemetry/{ingest,batch}` — телеметрия
(исключение владельца).

### D. Переменные окружения: читаются, но нигде не задаются

Проверка повторяет `R61-env-vars.md`; ниже — то, что относится к поводу задачи, плюс новое.
Всего прочитано 107 имён `process.env.*`; не описаны в `.env*.example` / `docker-compose*.yml` /
`Dockerfile*` / `deploy/**` / `observability/**` / `validate-env.ts` — 69 (в основном `LOG_*`,
e2e-логины, `PRISMA_*` самого клиента Prisma, `MQTT_*` телеметрии).

| # | severity | уверенность | path:line | проблема | сценарий / почему важно | предлагаемое действие |
|---|---|---|---|---|---|---|
| 46 | мелочь | высокая | `load-tests/slo-monitor.ts:326` | `WS_BASE_URL` — читается, нигде не задаётся; дефолт `http://localhost:3001` — порт удалённого ws-сервера | След удаления ws: монитор нагрузочных тестов по-прежнему стучится к несуществующему сервису, а весь файл описывает «WS connection count» и «event delivery latency» (`load-tests/slo-monitor.ts:1–10`). `npm run`-скрипта на этот файл нет, в `package.json` он не упомянут | Удалить ws-часть монитора или файл целиком (сверить с R58) |
| 47 | мелочь | высокая | `scripts/validate-env.ts:107` | пустой комментарий-заглушка `// WebSocket — optional` после удаления переменных ws | Остаток рефакторинга `a8567732`; вводит в заблуждение, что рядом есть ws-настройка | Удалить строку |
| 48 | мелочь | высокая | `setup.sh:4,54,112` | текст установщика всё ещё обещает сервис WebSocket и печатает `ws://localhost:3001` | Пользователь, поднимающий окружение по `setup.sh`, ждёт сервис, которого нет | Обновить комментарии и вывод |
| 49 | мелочь | средняя | `.gitnexus/meta.json` (`lastCommit: f45375f3`, `indexedAt: 2026-09-26T14:44`) | индекс кода построен **до** удаления ws | `impact`/`detect_changes` (обязательные по AGENTS.md) знают `src/core/realtime/server/auth.ts`, `ws-publisher.ts`, `checkers/websocket.ts`, `Dockerfile.ws` — это 12 упоминаний `src/core/realtime` в `.gitnexus/gitnexus.json`. Анализ влияния отвечает по несуществующему коду и может «спасти» мёртвый файл или спрятать реального потребителя | Переиндексировать: `node .gitnexus/run.cjs analyze --index-only` |
| 50 | мелочь | средняя | `scripts/add-runtime.js:10` | одноразовый кодмод перечисляет `src/app/api/auth/pin/route.ts` — файла нет | Список устарел; сам скрипт — исторический артефакт | Удалить скрипт или строку |

### E. Прочие хвосты удаления ws (проверено, чисто)

Обход всех импортов `src/**` **не нашёл ни одного неразрешимого специфаера** (8 «неразрешённых» —
все ложные: `@/generated/postgres-client` — каталог `.d.ts`). В `src/` не осталось обращений к
`@/core/realtime`, `startRealtimePublisher`, `WS_URL`; слово «WebSocket» встречается трижды —
только в комментариях (`src/app/api/monitoring/fleet/route.ts:8`,
`src/components/piling/monitoring/fleet-dashboard.tsx:97`, `scripts/validate-env.ts:107`).
`docs/runbooks/005-websocket-crash.md` уже помечен «УСТАРЕЛ» (`:1`) — не находка.
Неработающими остались только `.claude/skills/*` (`pilingtrack-architecture-contract:174,267,279`,
`pilingtrack-config-and-flags:106,116`, `pilingtrack-failure-archaeology:223`,
`pilingtrack-testing-and-evidence:194`), которые ссылаются на удалённые файлы как на живые, —
это учебные материалы, вне `src/`, но они способны увести агента (фиксируется, правка — отдельная задача).

## Топ-10 самых надёжных кандидатов на удаление

Отсортировано по «уверенность × отсутствие риска».

1. `src/components/ui/toaster.tsx:13` + `src/components/ui/toast.tsx:1` + `src/lib/hooks/use-toast.ts:195`
   — связный мёртвый остров Radix-тостов (256 строк), приложение использует sonner.
   Динамический вызов невозможен: `next/dynamic`/`React.lazy` в репозитории нет ни одного.
2. `src/components/piling/admin-reports/index.tsx:3` — barrel из одной строки, живой путь идёт
   напрямую через `reports-module.tsx:8`.
3. `src/components/piling/admin-reports/types.ts:12,23` — файл целиком из двух неиспользуемых типов.
4. `src/modules/crews/application/{commands,queries}/index.ts` + `src/modules/equipment/application/
   {commands,queries}/index.ts` — четыре barrel-файла по 1–2 строки без потребителей.
5. `src/core/storage/index.ts:4`, `src/core/notifications/index.ts:4`,
   `src/core/error-boundary/index.ts:1` — три barrel-фасада `core/`, никем не читаемые.
6. `src/services/reports/index.ts:1` — фасад, который сам себя помечает устаревшим и подлежащим
   удалению «в следующей мажорной версии».
7. `src/lib/seed/equipment.seed.ts:74` — `seedEquipment` вызывается только из себя;
   `prisma/seed.ts` его не импортирует.
8. `src/lib/hooks/use-mobile.ts:5` — `useIsMobile` без единого потребителя.
9. `src/core/shared/types/event-contracts.ts:256` — 256 строк доменных контрактов событий; живой
   экспорт (`TypedEnvelope`) мёртв, остальные файл использует только сам.
10. `src/components/piling/to/to-module-bits.tsx:22,106,176,186` — четыре UI-хелпера ТО без
    потребителей (в отличие от соседних компонентов того же файла).

**Сознательно не предложены к удалению** (не «мёртвый код», хотя недостижимы или непотребимы):
замороженный остров экрана оператора (6 файлов, AGENTS.md §4), `src/modules/telemetry/index.ts`,
роли Мастер/Инженер ОТ, tenancy-код, `src/core/security/**`, `src/modules/reports/api/**`, ORION.
Маршруты из раздела C я бы **не удалял до решения владельца** — это скорее недоделанный функционал
(разрешение на пуск, отмена смены, подпись журнала), чем мусор.

## Приложение B1 — остальные 87 мёртвых экспортов (`path:line :: имя`)

Мёртвые экспорты ORION (замороженная зона, 5): `src/components/orion/orion-content.ts:115,124,130,135,156`.
Конвенции Next (не кандидаты, 2): `src/instrumentation.ts:8 :: onRequestError`,
`src/instrumentation-client.ts:36 :: onRouterTransitionStart`.
Прочие:

```
src/core/infrastructure/raw-queries.ts:132 :: getSiteDailySummaryRaw
src/core/security/encryption.ts:213 :: generateEncryptionKey        # security-зона, только сведения
src/lib/cache-metrics.ts:42,47,52,57,61,70,137                      # запись метрик кеша
src/lib/cache-strategies.ts:75,79,200,406,415,426
src/lib/db.ts:211 :: DatabaseClient
src/lib/haptic-feedback.ts:37 :: hapticSubmit
src/lib/logger.ts:126 :: withRequestLogging
src/lib/media-thumbnails.ts:114 :: clearThumbnailCache
src/lib/pagination-cursor.ts:65 :: PaginatedResponse
src/lib/pdf-queue.ts:245,268
src/lib/request-context.ts:48,63,70,104
src/lib/timezone.ts:105 :: detectBrowserTimezone
src/lib/types.ts:82,87,152,392,456,487
src/lib/validation-schemas.ts:18,58,198,228,328,362,378,386,433,450-465
src/modules/operator-mobile/domain/hazard-classification.ts:49,52,55,100
src/modules/operator-mobile/domain/ppe.ts:45
src/modules/operator-mobile/domain/work-warnings.ts:272
src/modules/readiness/application/command-pipeline/etag.ts:60
src/modules/readiness/domain/readiness-rules.ts:106
src/modules/readiness/domain/readiness-score.ts:235
src/modules/readiness/domain/shifts/types.ts:19,32
src/modules/readiness/infrastructure/audit/verify-chain.ts:81
src/services/system/system-service.ts:20 :: getReadinessStatus
src/components/piling/admin-equipment/equipment-card-template.ts:124
src/components/piling/admin-equipment/equipment-dialogs.tsx:162
src/components/piling/admin-sites/hierarchy-tree.tsx:218 :: ExpandedTreeContent
src/components/piling/analytics-dashboard/kpi-catalog.ts:46,50
src/components/piling/monitoring/equipment-tile-template.ts:18,20
src/components/piling/operator-mobile/downtime-interval.ts:25 :: hhmmAgo
src/components/piling/operator/shift-phase.ts:41 :: phaseTitle         # зона оператора
src/components/piling/to/readiness-design-views.tsx:149,258,319,379,460,522
src/components/piling/to/readiness/api/idempotency.ts:2,15
src/components/piling/to/readiness/readiness-labels.ts:32
```

**76 экспортов, используемых только тестами** (в скобках — тест): ключевые —
`src/core/infrastructure/raw-queries.ts:203,254 :: upsertReportRaw/bulkDeleteReportsRaw`,
`src/services/reports/outbox-publisher.ts:241 :: publishOutboxEvents` (зовёт только
`src/workers/__tests__/outbox-worker.test.ts` — проверить, что публикация outbox идёт иным путём),
`src/modules/readiness/domain/permits/transitions.ts:38 :: transitionPermit`,
`src/modules/readiness/domain/shifts/transitions.ts:66,83 :: transitionShift/transitionHandover` —
машины состояний наряда и смены не вызываются рабочим кодом (только тесты), при том что смены
переводятся командами; `src/services/weather/weather-client.ts:123 :: getSiteWind`;
`src/components/piling/to/to-stats.ts:64,121 :: findOverdueMaintenance/findUncrewedEquipment`;
`src/modules/inspections/domain/state-diff.ts:75 :: describeStateChanges`. Полный список — вывод
скрипта (см. «Методика», шаг 3).

## Не проверено

- **Исполнение проверок не запускалось** (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`):
  задача read-only, а `npm run build`/`tsc` пишут в `.next/dev/types` и правят состояние сборки.
  Поэтому утверждение «битых импортов нет» опирается на собственный резолвер путей, а не на
  компилятор: он не различает типы и может не увидеть ссылку на тип внутри строкового union.
- **`export * from` из barrel-файлов** я не разворачивал: если потребитель берёт символ из barrel,
  литерал имени всё равно присутствовал бы у потребителя, поэтому поиск по имени его находит, — но
  обратный случай (barrel реэкспортирует мёртвого кандидата) полностью не исключён.
- **Динамический вызов по нестатистически вычисляемой строке** (`import(someVar)`, имя route-файла
  из конфигурации БД, внешний планировщик, обращение к API из внешней системы, о которой в
  репозитории нет файлов): проверить средствами репозитория невозможно. Найденные механизмы —
  только `import()` с литеральными путями (`src/app/api/telemetry/route.ts`,
  `src/workers/embedded-workers.ts`) и шаблонные URL с сегментом-действием (разобраны вручную).
- **Прод-окружение и внешние потребители** (боевой nginx/Caddy, cron/systemd, внешние интеграции,
  боевой `.env`) не читались: AGENTS.md §1 запрещает доступ. Например, `/api/briefings/[id]/sign`
  теоретически может вызываться мобильным клиентом вне репозитория — это не проверено.
- **`src/modules/reports/api/**`** — исключено решением владельца, в анализ не включалось.
- **Реальная «живость» функционала** (можно ли сейчас подписать журнал инструктажей, снять
  блокировку пуска, отменить смену) оценивалась по наличию вызовов маршрута в коде; продуктовые
  обходные пути, если они есть, не искались целенаправленно.
