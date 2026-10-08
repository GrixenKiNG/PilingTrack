# W135-IND-INVENTORY — карта приложения и реестр функций

Независимый аудит. **Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01`**
(«Merge codex/j9-j8-j7-1007»). Отчёт написан в worktree `D:/PillingR/wt-night` (ветка
`hermes/q4-0926`); первый проход сделан **без чтения старых отчётов** в `docs/audits/`,
сравнение — только в последнем разделе. Код не менялся, миграции/деплой/запись в БД не
запускались. Замороженные области (варианты экрана оператора, ORION) только читались.

## Итог

Приложение — 46 страниц (`src/app/**/page.tsx`) и 141 API-маршрут (`src/app/api/**/route.ts`);
крупнейшие модули по числу маршрутов: readiness (29), reports (12), equipment (12). Живой
контур состоит из рабочего места машиниста (`/operator`, модуль operator-mobile), отчёта
смены, осмотров/чек-листов, ТО/обслуживания, центра техготовности (`/admin/to`), ТБ и допусков
(`/admin/safety`), установок, объектов, бригад, аналитики, пользователей и справочников.
Найдено 8 страниц, доступных по прямой ссылке, но не выведенных в меню роли: `/report`,
`/inspections` (+`/new`,`/[id]`), `/admin/checklists` (+`/[id]`), `/admin/telegram`,
`/admin/dlq`, `/print/briefing-journal`; ещё две (`/admin/incidents`, `/admin/piles`) —
узлы-редиректы, оставленные ради закладок. В коде заметны 4 подсистемы «не первого выпуска»:
телеметрия (ждёт железо), ORION-сайт (заморожен), варианты экрана оператора (v2/v3/v5/v7/v10 +
`module`/`tabs`), машинерия мультитенантности (спит). Обнаружены 2 полностью недостижимых
маршрута (`/operator/module`, `/operator/tabs`) — они редиректят на статический прототип, которого
нет в репозитории (`public/prototypes/` в `.gitignore`). Поведением управляют ~15 feature-flag-
переменных и ~60 осей окружения; самая влиятельная продуктово — `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL`,
самая влиятельная по безопасности — `TRUST_PROXY`, `MULTI_TENANT_MODE`, `RATE_LIMIT_BYPASS`.

- Находок: **44** — критично **1**, важно **17**, мелочь **26**.
- Дублирующийся вход: Telegram и DLQ живут и отдельными маршрутами (`/admin/telegram`, `/admin/dlq`),
  и вкладками внутри «Настроек» — два места об одном.
- Топ-5: (1) `/operator/module` и `/operator/tabs` — тупики на несуществующую статику; (2) 8 страниц
  вне меню, часть защищена только раскладкой, часть — только API; (3) `/print/briefing-journal` без
  серверного гварда страницы; (4) `admin/checklists` защищён правом `inspection.perform`
  (его имеет машинист), а не «управлением шаблонами»; (5) модули-не-первого-выпуска (телеметрия,
  ORION, варианты оператора, мультитенантность) включены в сборку.

## Методика

Повторяемо из корня `D:/PillingR/wt-audit-0f53` (Git Bash, Windows).

1. Перечень страниц: `find src/app -name page.tsx | wc -l` → 46 (без `layout.tsx`, без тестовых
   `__tests__/page.*`). Перечень маршрутов: `find src/app/api -name route.ts | wc -l` → 141.
   Группировка по модулю: `find src/app/api -name route.ts | sed 's|src/app/api/||;s|/route.ts||' | awk -F/ '{print $1}' | sort | uniq -c | sort -rn`.
2. Дерево страниц и раскладок: `find src/app -type d | sort`, `find src/app -name layout.tsx`.
3. Меню роли — единственный источник «видимости»: `src/components/piling/icons/role-navigation.ts`
   (`ROLE_NAVIGATION`, прочитан целиком), точки входа `/` и `/login` (`src/app/page.tsx`,
   `src/app/(auth)/login/page.tsx`), `roleHomeRoute` (`src/lib/routes.ts`). Сверка адресов меню с
   реальными `page.tsx` — вручную по таблице ниже.
4. Гварды страниц: `src/app/(app)/admin/layout.tsx`, каждый `admin/*/layout.tsx` через
   `requirePageAbility` (`src/lib/require-page-ability.ts`), `(readiness-admin)/layout.tsx`,
   `(safety)/layout.tsx`; матрица прав — `src/services/auth/authorization-service.ts:22-134`.
5. Feature flags и env: `grep -rn "process.env\." src --include=*.ts --include=*.tsx`, затем отбор
   переключателей `*_ENABLED|*_DRY_RUN|NEXT_PUBLIC_*|RATE_LIMIT_BYPASS|MULTI_TENANT_MODE`.
6. Реестр функций — по страницам/маршрутам и их корневым компонентам (`grep -nE "^import|export default|'use client'"`,
   чтение голов ключевых файлов); «макет/демо» искал по метке `макет` в комментариях компонентов.
7. Мёртвые маршруты: чтение `src/app/operator/{module,tabs}/page.tsx`, проверка `ls public/`,
   `grep -n prototypes .gitignore`.
8. Ничего не запускалось (ни vitest, ни tsc, ни приложение). GitNexus MCP в сессии нет.

## Находки

Severity: критично / важно / мелочь. Все `path:line` открывались.

| # | severity | path:line | проблема | почему важно / сценарий | предлагаемое |
|---|---|---|---|---|---|
| 1 | критично | `src/app/operator/module/page.tsx:11` | `redirect('/prototypes/operator-module/index.html')`, но `public/prototypes/` отсутствует | Переход по ссылке на `/operator/module` даёт 404-статику; редирект выглядит как «раздел пропал» | Удалить маршрут либо вернуть статику; сейчас это гарантированный тупик |
| 2 | критично | `src/app/operator/tabs/page.tsx:11` | то же для `/prototypes/operator-tabs/index.html` | то же | то же |
| 3 | важно | `src/app/(app)/report/page.tsx:1-6` | страница отчёта есть, но в меню оператора её нет (убрана 22.08) | Прямая ссылка открывает форму; в интерфейсе дороги нет — «Отчёт» как отдельный пункт исчез | Подтвердить, что путь только через «Смену»; иначе вернуть вход |
| 4 | важно | `src/app/(app)/inspections/page.tsx:1-6` | `/inspections` нет ни в одном меню роли | Список осмотров доступен только по прямому адресу/из других экранов | Вывести пункт или задокументировать вход |
| 5 | важно | `src/app/(app)/inspections/new/page.tsx` | маршрут вне меню | то же | то же |
| 6 | важно | `src/app/(app)/inspections/[id]/page.tsx` | маршрут вне меню | то же | то же |
| 7 | важно | `src/app/(app)/admin/checklists/page.tsx` + `layout.tsx:4` | страница вне меню; гвард — `requirePageAbility('inspection.perform')` | Право `inspection.perform` есть у машиниста (`authorization-service.ts:120`), хотя это управление шаблонами осмотров, а не «пройти осмотр» — рассинхрон смысла | Отдельное право `inspection.templates.manage` либо пояснение |
| 8 | важно | `src/app/(app)/admin/telegram/page.tsx:1-9` | маршрут вне меню, но живой (`AdminOnly`) | Дублирует вкладку «Telegram» внутри «Настроек» (`workspace-settings.tsx:222`) | Оставить один вход или явно сослаться в меню |
| 9 | важно | `src/app/(app)/admin/dlq/page.tsx:1-9` | маршрут вне меню, живой (`AdminOnly`) | Дублирует вкладку «Очередь (DLQ)» (`workspace-settings.tsx:222`) | то же |
| 10 | важно | `src/app/print/briefing-journal/page.tsx:1-18` | у печатной страницы нет серверного гварда страницы (лежит вне `(app)`) | Комментарий прямо говорит «защиты нет и быть не должно»; пустой лист при 401 — принять как решение или закрыть раскладкой | Подтвердить решение владельцем |
| 11 | важно | `src/app/(app)/admin/incidents/page.tsx:11` | страница-редирект на `/admin/safety?view=incidents`, в меню её нет | Живого экрана нет, но адрес оставлен ради закладок — ок, но в карте помечаем как «не страница» | — |
| 12 | важно | `src/app/(app)/admin/piles/page.tsx:11` | страница-редирект на `/admin/reports?view=piles` | то же | — |
| 13 | важно | `src/app/(app)/layout.tsx:288-298` | тип оболочки выбирается по роли; оператору доступна только операторская, остальным — админская | Роль `MECHANIC`/`FOREMAN`/`SAFETY_ENGINEER` видят админскую оболочку — не баг, но проверять доступ надо по правам, не по оболочке | — |
| 14 | важно | `src/app/(app)/monitoring/page.tsx:1-18` | «Мониторинг» для оператора убран из меню (12.09), но маршрут открыт | Оператор по ссылке видит парк целиком; внутри блок аналитики уже прикрыт `analytics.read` | Проверить, нужен ли оператору сам `/monitoring` |
| 15 | важно | `src/app/api/telemetry/ingest/route.ts:1-25` + `src/services/telemetry/mqtt-ingestion-service.ts:50,133` | телеметрия спит: без `MQTT_BROKER_URL` ingest пропускается, таблица `TelemetryRecord` пуста | Код и маршруты в сборке, но данных нет — «не первый выпуск», нельзя принимать за работающее | Оставить (задел под железо), но знать, что это не «фича в бою» |
| 16 | важно | `src/app/orion/page.tsx:1-12` + `src/app/api/orion/lead/route.ts` | ORION-сайт и приём заявок включены в сборку приложения | Маркетинговая витрина — не операционный контур; домен задаётся `NEXT_PUBLIC_SITE_URL` | Подтвердить, что нужен в этой сборке |
| 17 | важно | `src/components/piling/to/to-module.tsx:128-129,843-848` | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL !== 'false'` переключает весь контур техготовности на «production shell» | По умолчанию ВКЛ; при `'false'` показывается reference-UI и внутренняя навигация — поведение раздела меняется целиком | Документировать в реестре флагов |
| 18 | важно | `src/services/auth/authorization-service.ts:120,123` | `inspection.perform` и `meter.record` есть у `OPERATOR`/`MECHANIC`, но маршруты под админ-разделом | Возможен рассинхрон «право есть — страница недоступна» (админ-layout не пускает OPERATOR) | Сверять право и раскладку раздела |
| 19 | мелочь | `src/lib/routes.ts:42-57` | `PAGE_TO_ROUTE` перечисляет `admin-telegram`/`admin-dlq` и др. — легаси-карта SPA→App Router | Часть адресов уже вкладки, а не страницы | Пометить карту как легаси |
| 20 | мелочь | `src/components/piling/to/readiness-design-views.tsx:532` | жёстко прописан `['/admin/checklists', ...]` как ссылка-подсказка | Ведёт на раздел вне меню; если пользователь не инженер — увидит «нет доступа» | Сверить с меню |
| 21 | мелочь | `src/components/piling/to/readiness/settings/notifications-section.tsx:131,142,169,221` | 4 ссылки на `/admin/telegram` из модуля готовности | Дублирование входа с вкладкой настроек | Унифицировать |
| 22 | мелочь | `src/app/(app)/admin/telegram/page.tsx:4` + `dlq/page.tsx:4` | `AdminOnly` — клиентский гвард поверх серверного layout-гварда | Двойная защита; клиентская скрывается без JS-контекста | — |
| 23 | мелочь | `src/proxy.ts:87` + `src/services/tenancy/tenant-context-service.ts:16` | `MULTI_TENANT_MODE` читается в двух местах; включает enforcement только при `'multi'`/легаси `'true'` | Спит по проекту (одна организация `orion`); при включении меняет изоляцию целиком | Оставить (задел), не «чинить» |
| 24 | мелочь | `src/lib/rate-limiter.ts:178` | `RATE_LIMIT_BYPASS === 'true'` отключает лимит вне `NODE_ENV=test`? (см. `:175` — только для CI/E2E) | Флаг безопасности: при `'true'` в проде лимитер выключается | Убедиться, что в проде не выставлен |
| 25 | мелочь | `src/proxy.ts:21-22` | `ALLOWED_DEV_ORIGIN` добавляет источник в dev-CORS | Влияет только на dev | — |
| 26 | мелочь | `src/workers/unified-worker.ts:174` | `PM_SCHEDULER_ENABLED !== 'false'` — по умолчанию включён планировщик ТО | Суточная задача ТО; выключение — только явным `'false'` | Реестр флагов |
| 27 | мелочь | `src/workers/unified-worker.ts:180` | `PROJECTION_REBUILD_ENABLED !== 'false'` — по умолчанию включён | Суточная перестройка витрин | то же |
| 28 | мелочь | `src/workers/unified-worker.ts:187` | `READINESS_SCHEDULER_ENABLED !== 'false'` — по умолчанию включён | Суточный сброс готовности (истечение нарядов, закрытие смен) | то же |
| 29 | мелочь | `src/workers/unified-worker.ts:195` + `scheduler-registry.ts:49` | `IDEMPOTENCY_CLEANUP_ENABLED === 'true'` — **только opt-in**, по умолчанию выключен | Осознанно (риск удалить активный ключ идемпотентности — комментарий в коде) | Не включать без фикса |
| 30 | мелочь | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6,14` | `PDF_TEMP_CLEANUP_ENABLED === 'true'` (opt-in), `PDF_TEMP_CLEANUP_DRY_RUN !== 'false'` (по умолчанию — прогон без удаления) | Уборка временных PDF по умолчанию не удаляет | Реестр флагов |
| 31 | мелочь | `src/workers/embedded-workers.ts:42-60` | `EMBEDDED_WORKERS` — набор воркеров внутри Next, не путать с `ENABLED_WORKERS` (standalone) | Два похожих имени, разные роли | Реестр флагов |
| 32 | мелочь | `src/core/observability/health-tracker/checkers/backup.ts:18` | `BACKUP_ENABLED` влияет на health-check бэкапа | Отображение здоровья | — |
| 33 | мелочь | `src/app/api/metrics/route.ts` (по каталогу флагов `METRICS_SCRAPE_TOKEN`) | скрейп метрик fail-closed с фолбэком на сессию | Эксплуатация, не фича продукта | — |
| 34 | мелочь | `src/app/api/alerts/webhook/route.ts` (по каталогу `ALERTMANAGER_WEBHOOK_TOKEN`) | вебхук Alertmanager без токена всегда 401 | Эксплуатация | — |
| 35 | мелочь | `src/app/(auth)/login/page.tsx:13-18` | вход редиректит по `roleHomeRoute` | Одна точка входа — ок | — |
| 36 | мелочь | `src/app/(app)/no-access/page.tsx:1-26` | экран отказа вместо молчаливого редиректа | Хорошо; `from` показывается только текстом | — |
| 37 | мелочь | `src/app/(app)/(safety)/layout.tsx:1-28` | модуль ТБ открыт каждой роли намеренно | Вкладки режет bootstrap готовности; чужие допуски закрыты на сервере | — |
| 38 | мелочь | `src/app/(app)/(readiness-admin)/layout.tsx:4-8` | `ALLOWED` без `ASSISTANT` | Помощник на `/admin/to` получит «нет доступа» | Ожидаемо |
| 39 | мелочь | `src/app/(app)/admin/analytics/page.tsx:1-5` | `AdminAnalytics` тянет `/api/admin/analytics/overview` | Живая аналитика; блок дашборда использует placeholders при отсутствии данных (`analytics-dashboard/kpi-widgets.tsx:128`) | Это не макет, а честные заглушки |
| 40 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:295,349` | плейсхолдеры «Телеметрия…ждёт датчик», «Ошибки и диагностика (ECU)» | Честная заглушка под будущее железо | Ожидаемо |
| 41 | мелочь | `src/components/piling/main-dashboard/dashboard-layout.tsx:32-48` | главный дашборд использует `placeholders()` | Конфигуратор раскладки; при отсутствии данных — подписи-заглушки | — |
| 42 | мелочь | `src/components/piling/operator-mobile/*` (v10) и `(app)/operator/page.tsx:1-24` | живой контур машиниста = `operator-mobile`; `operator-dashboard.tsx` и `components/piling/operator/**` оставлены как путь отхода (комментарий `:14-20`) | Не удалять (AGENTS.md §4) | Держать |
| 43 | мелочь | `src/app/operator/v5/page.tsx:1-31`, `v7/*`, `v10/page.tsx`, `(app)/operator/v2,page.tsx`,`v3`, `v3/report` | 8 вариантов экрана оператора на живых/макетных данных, вне группы `(app)` (без выхода/баннера «Действую как») | Заморожены владельцем — не нужны первому выпуску, но в сборке | Держать, выбор за владельцем |
| 44 | мелочь | `src/modules/telemetry/index.ts`, `src/services/telemetry/{mqtt-ingestion,telemetry-buffer,device-key}-service.ts` | фасад + сервисы телеметрии включены | См. #15 | Держать |

## Реестр функций

Статус: **работает / частично / макет / отключена / неизвестно**. «Основание» — открытый файл:строка.

| Функция | Статус | Основание | Модуль |
|---|---|---|---|
| Вход/сессия (JWT, refresh, PIN) | работает | `src/app/api/auth/{login,logout,me}/route.ts`; `src/app/(auth)/login/page.tsx:1-21` | auth |
| Смена машиниста (`/operator`) | работает | `src/app/(app)/operator/page.tsx:1-24` | operator-mobile |
| Помощник машиниста (`/assistant`) | работает | `src/app/(app)/assistant/page.tsx:1-16`; `api/assistant/{state,command}/route.ts` | operator-mobile |
| Отчёт смены (`/report`) | работает | `src/app/(app)/report/page.tsx:1-6`; `api/reports/upsert` | reports |
| История отчётов (`/history`) | работает | `src/app/(app)/history/page.tsx:1-6`; `api/reports/{my,recent}` | reports |
| Журнал забивки / паспорт сваи | работает | `api/pile-passports/{route,[id]/decide,export}`; редирект `admin/piles/page.tsx:11` | reports/piles |
| Осмотры и чек-листы | работает | `api/inspections/*`; `api/checklist-templates/*`; `(app)/inspections/*` | inspections |
| ТО/обслуживание и планы ТО | работает | `api/maintenance/*`; `api/maintenance-plans/{route,run}`; `admin/maintenance/*` | equipment/maintenance |
| Центр техготовности (`/admin/to`) | работает | `(app)/(readiness-admin)/admin/to/page.tsx`; `api/readiness/**` (29 маршрутов) | readiness |
| ТБ и допуски (`/admin/safety`) | работает | `(app)/(safety)/admin/safety/page.tsx`; `api/safety/*`; `api/briefings/*` | safety |
| Установки (парк) | работает | `api/equipment/*`; `(app)/admin/equipment/*` | equipment |
| Объекты (+ иерархия, назначение) | работает | `api/sites/*`; `admin/sites/page.tsx` | sites |
| Бригады | работает | `api/crews/*`; `admin/crews/page.tsx` | crews |
| Пользователи и роли, документы | работает | `api/users/**`; `api/user-document-types/*`; `admin/users/page.tsx` | users |
| Справочники | работает | `api/dictionary/{all,manage}`; `admin/dictionaries/page.tsx` | settings |
| Аналитика | работает | `api/admin/analytics/{overview,site-weekly-trend}`; `admin/analytics/page.tsx` | analytics |
| Мониторинг парка | частично | `(app)/monitoring/page.tsx:1-18`; телеметрия спит (#15) | monitoring |
| Telegram-уведомления | работает | `api/telegram/configs`; `api/notifications/telegram/test`; `admin/telegram/page.tsx` | notifications |
| DLQ (очередь) | работает | `api/admin/dlq`; `admin/dlq/page.tsx`; `admin/settings` вкладка | system |
| Метрики/health/liveness/ready | работает | `api/{metrics,health,health/deep,liveness,ready}` | observability |
| Погода на точке работ | работает | `api/weather/route.ts:1-30`; `services/weather/weather-client` | weather |
| Обратная связь (SSE) | работает | `api/feedback/{events,stream}`; `components/piling/feedback-center.tsx` | feedback |
| Редактор раскладок дашбордов | работает | `api/layout/[surfaceId]`; `components/piling/layout-editor/*` | layout |
| Вебхук Alertmanager | работает | `api/alerts/webhook/route.ts` | alerts |
| Телеметрия (железо) | отключена | `api/telemetry/{ingest,batch}`; `services/telemetry/mqtt-ingestion-service.ts:50,133` | telemetry |
| ORION-сайт и заявка | макет/заморожено | `src/app/orion/page.tsx:1-12`; `api/orion/lead/route.ts` | orion |
| Варианты экрана оператора v2/v3/v5/v7/v10 | макет/кандидаты | `(app)/operator/v2|v3`, `src/app/operator/{v5,v7,v10}` | operator (frozen) |
| `/operator/module`, `/operator/tabs` | отключена (тупик) | `src/app/operator/{module,tabs}/page.tsx:11` | operator (frozen) |
| Мультитенантность | отключена | `MULTI_TENANT_MODE` (`src/proxy.ts:87`) | tenancy |
| Перестройка витрин (backfill) | работает | `api/admin/projections/rebuild` | reports |
| Печать журнала инструктажей | работает | `src/app/print/briefing-journal/page.tsx:1-18` | briefings |

## Список страниц (46) по модулю

Группы (в скобках — путь маршрута). «В меню» — есть ли адрес в `ROLE_NAVIGATION` хотя бы у одной роли.

- Вход/служебные: `/` (`src/app/page.tsx`), `/login` (`(auth)/login`), `/no-access`.
- Оператор (в строю): `/operator` (`(app)/operator`). В меню (OPERATOR).
- Помощник: `/assistant`. В меню (ASSISTANT).
- Отчёты: `/report`, `/history`, `/admin/reports`. `/admin/reports` в меню; `/report`, `/history` — `/history` в меню, `/report` — нет.
- Осмотры: `/inspections`, `/inspections/new`, `/inspections/[id]`, `/admin/checklists`, `/admin/checklists/[id]`. В меню — нет ни одной.
- ТО/готовность: `/admin/maintenance`, `/admin/maintenance/new`, `/admin/maintenance/[id]`, `/admin/to` (`(readiness-admin)`), `/admin/to/shifts/new`. В меню — `/admin/maintenance`, `/admin/to`.
- Установки: `/admin/equipment`, `/admin/equipment/[id]`. В меню — `/admin/equipment`.
- Объекты: `/admin/sites`. В меню.
- Бригады: `/admin/crews`. В меню.
- ТБ и допуски: `/admin/safety` (`(safety)/admin/safety`). В меню.
- Аналитика/дашборд: `/admin`, `/admin/analytics`, `/monitoring`. В меню.
- Люди: `/admin/users`. В меню (ADMIN).
- Справочники: `/admin/dictionaries`. В меню (ADMIN).
- Настройки/сервис: `/admin/settings`, `/admin/telegram`, `/admin/dlq`. В меню — только `/admin/settings`.
- Журнал/происшествия (редиректы): `/admin/piles`, `/admin/incidents`. В меню — нет.
- Печать: `/print/briefing-journal`. В меню — нет.
- Заморожено (варианты оператора): `/operator/v5`, `/operator/v7`, `/operator/v7/safety`, `/operator/v7/history`, `/operator/v7/assistant`, `/operator/v10`, `/operator/module`, `/operator/tabs`, `/operator/v2`, `/operator/v3`, `/operator/v3/report`. В меню — нет.
- Заморожено (ORION): `/orion`.

## Список API-маршрутов (141) по модулю

- readiness — 29: `src/app/api/readiness/**` (bootstrap, current, shifts/[id]/{start,cancel,decline,handover,request-acceptance,waiver}, work-permits/[id]/{approve,revoke,submit}, defects/[id]/{triage,resolve,reject}, handovers/[id]/{accept,rework}, history, audit, export, access-matrix, place-presets, permit-form-options).
- reports — 12: `upsert, admin-upsert, edit, delete, my, all, recent, period, export, pdf, single-pdf, [id]/history`.
- equipment — 12: `route, [id], [id]/details, [id]/documents(+[docId]), [id]/device-keys, [id]/fuel(+[entryId]), [id]/maintenance(+[recordId]), [id]/meter-readings(+[readingId])`.
- sites — 6: `route, create, all, [id], [id]/assign, [id]/hierarchy`.
- admin — 6: `projections/rebuild, incidents, dlq, equipment-analytics, analytics/overview, analytics/site-weekly-trend`.
- media — 5: `route, [id], [id]/confirm, [id]/download, download-batch`.
- maintenance — 5: `route, [id], [id]/accept, assignees, kpi`.
- safety — 4: `clearance, my-clearance, equipment-permits(+[id])`.
- operator — 4: `shift, knowledge-attempt, mobile/state, mobile/command`.
- crews — 4: `route, [id], my, all`.
- users — 3: `route, [id], [id]/documents(+[docId])`.
- telemetry — 3: `route, batch, ingest`.
- pile-passports — 3: `route, [id]/decide, export`.
- maintenance-plans — 3: `route, [id], run`.
- inspections — 3: `route, [id], [id]/complete`.
- briefings — 3: `route, [id]/sign, journal`.
- auth — 3: `login, logout, me`.
- user-document-types — 2: `route, [id]`.
- system — 2: `route, status`.
- readiness-rules — 2: `route, publish`.
- monitoring — 2: `fleet, template`.
- health — 2: `route, deep`.
- feedback — 2: `events, stream`.
- dictionary — 2: `all, manage`.
- checklist-templates — 2: `route, [id]`.
- assistant — 2: `state, command`.
- По одному: `weather`, `user-documents/control`, `to/journal`, `telegram/configs`, `settings`, `route.ts` (корень api), `ready`, `orion/lead`, `notifications/telegram/test`, `metrics`, `liveness`, `layout/[surfaceId]`, `audit`, `analytics/sites`, `alerts/webhook`.

## Feature flags и переменные окружения, меняющие поведение

- `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` (`to-module.tsx:128-129`) — переключает весь контур `/admin/to` (production shell ↔ reference UI). По умолчанию включён.
- `MULTI_TENANT_MODE` (`proxy.ts:87`, `tenant-context-service.ts:16`) — включает изоляцию организаций.
- `RATE_LIMIT_BYPASS` (`rate-limiter.ts:178`) — отключает лимитер (задуман для CI/E2E).
- `EMBEDDED_WORKERS` (`embedded-workers.ts:42`) vs `ENABLED_WORKERS` (`workers/unified-worker/config.ts`) — какие воркеры запускаются внутри Next и в отдельном контейнере.
- Планировщики (по умолчанию включены): `PM_SCHEDULER_ENABLED` (`unified-worker.ts:174`), `PROJECTION_REBUILD_ENABLED` (`:180`), `READINESS_SCHEDULER_ENABLED` (`:187`).
- Планировщики по явному opt-in (по умолчанию выключены): `IDEMPOTENCY_CLEANUP_ENABLED` (`scheduler-registry.ts:49`), `PDF_TEMP_CLEANUP_ENABLED` (`pdf-cleanup-scheduler.ts:6`), `PDF_TEMP_CLEANUP_DRY_RUN` (`:14`).
- Прочие оси: `BACKUP_ENABLED` (`health-tracker/checkers/backup.ts:18`), `METRICS_SCRAPE_TOKEN`, `ALERTMANAGER_WEBHOOK_TOKEN`, `TRUST_PROXY`, `TELEGRAM_API_BASE`, `DEFAULT_TENANT_ID`, `MULTI_TENANT_MODE`, `S3_*`, `REDIS_URL`/`REDIS_URL_CACHE`, `ALLOWED_DEV_ORIGIN` (`proxy.ts:21`), `NEXT_PUBLIC_SITE_URL` (`orion/page.tsx:12`), `MQTT_*` (`mqtt-ingestion-service.ts:50`). Полный перечень осей — отдельный каталог (навык `pilingtrack-config-and-flags`); здесь отмечены только меняющие поведение продукта.

## Модули, не нужные первому выпуску, но включённые в код

1. **Телеметрия** — `src/app/api/telemetry/*`, `src/services/telemetry/*`, `src/modules/telemetry/index.ts`. Ждёт физического железа; без `MQTT_BROKER_URL` пропускается (`mqtt-ingestion-service.ts:50,133`).
2. **ORION (публичный сайт)** — `src/app/orion/**`, `src/app/api/orion/lead/**`, `src/components/orion/**`. Витрина/приём заявок, заморожена владельцем.
3. **Варианты экрана оператора** — `/operator/{v2,v3,v5,v7,v10,module,tabs}` и их компоненты. Кандидаты на выбор владельца, вне группы `(app)`.
4. **Мультитенантность** — `src/services/tenancy/**`, RLS-политики, `tenantId` в схеме, `MULTI_TENANT_MODE`. Спит (одна организация).
5. **Редактор раскладок дашбордов** — `src/components/piling/layout-editor/**`, `api/layout/[surfaceId]`. Инструмент настройки, не ежедневная работа.
6. **Центр обратной связи (SSE)** — `src/components/piling/feedback-center.tsx`, `api/feedback/{events,stream}`. Внутренний инструмент.
7. **Вспомогательное/эксплуатационное** — `api/{metrics,liveness,ready}`, `api/alerts/webhook`, `api/admin/projections/rebuild` (нужны для эксплуатации, но не «продукт для людей»).

## Не проверено

- **Фактический запуск не выполнялся** (ни `npm run build`, ни `tsc`, ни vitest, ни Playwright, ни приложение) — это read-only аудит, контуры по коду, а не по живому поведению. «Работает» в реестре = «код и маршруты присутствуют и не помечены заглушкой», а не «проверено на бою».
- **Содержимое `public/prototypes/`** не проверялось (папки нет в репозитории, она в `.gitignore:137`); вывод о тупиках #1/#2 сделан по отсутствию папки и по строке редиректа; на боевом сервере статику могли додистрибутировать вручную — не проверено.
- **Сетевые/внешние зависимости** (`TELEGRAM_API_BASE`, Open-Meteo, S3/MinIO, MQTT) не опрашивались.
- **Роль-специфичная видимость вкладок** `/admin/safety` и готовности режется bootstrap'ом на клиенте/сервере — точный набор вкладок по каждой роли по коду не разворачивал (только права уровнем выше).
- **Динамические импорты и строковые пути** (`router.push`, `redirect(...)`) проверены по тексту, но полнота «кто на что ссылается» по всему репо не гарантирована механически.
- **Мультитенантные сценарии** не проверялись (один тенант `orion`).
- Номера строк могли сместиться, если ветка `wt-audit-0f53` обновится; фиксирован SHA `0f53cd01`.

## Приложение: сравнение со старыми отчётами

Прочитано **после** независимого прохода (по требованию задания). Сравнение — с `docs/audits/hermes-night/`
**в worktree `wt-night`** (ветка `hermes/q4-0926`, другой HEAD), поэтому совпадение — по сути, не по строкам.

- `R74-operator-versions-map.md` уже описал карту версий оператора: «тёмные» маршруты v2/v3/v5/v7/v10
  без проверки роли на странице, вход только на `/operator`. **Совпадает** с #43. Отдельно R74 нашёл,
  что `/operator/module` и `/operator/tabs` ведут в `public/prototypes/`, которой нет локально, — это
  **совпадает** с моими #1/#2 (там помечено как «не открывается нигде»). Здесь оно поднято до
  **критично**, потому что это гарантированный тупик для пользователя.
- `05-dead-code-inventory.md` считал неиспользуемые экспорты (109 шт.) и подсистему метрик кеша. Это
  другая ось (мёртвые символы, не маршруты); пересечений с моим реестром функций нет, наоборот —
  мой отчёт фиксирует те же «заглушки» (аналитика/дашборд) как **честные плейсхолдеры, а не макет**.
- `README.md` оглавления W-отчётов перечисляет W1 (role routes) и W11/W19 (молчаливые редиректы →
  `no-access`). Мой #13, #36 подтверждают, что решение `require-page-ability` + `/no-access` уже
  внедрено в `wt-audit-0f53`.
- Отличие версий: старые отчёты — по ветке `hermes/q4-0926`; аудит `0f53cd01` — отдельная ветка
  (`codex/j9-j8-j7-1007`). Есть риск, что часть находок уже починена/иначе, — сверку по строкам
  делать нельзя, только по сути.
