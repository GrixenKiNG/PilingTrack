# K — мобильные размеры и фактическая область касания

Основа: fdd67ccf688ec63561f3939fd4b665032cba7525. Ветка codex/mobile-sizes-1023, отдельное дерево D:/PillingR/wt-mobile-sizes-1023. Результаты относятся к этой ветке; B/C/G не объединялись.

## Результат и граница принятия

Исправлены мобильные кнопки, фильтры, ссылки-переходы и мелкий текст админки. Проверка измеряет фактическое попадание указателя, включая padding, интерактивный ::after и связанные label. Порог 44×44 и 14px не снижен. Скрытое clipped-поле загрузки файла 1×1 не считается видимым контролом. Добавлена регрессия в существующий Playwright-файл, без новых отслеживаемых тестовых файлов.

Приёмка всей K НЕ завершена: подтверждено перекрытие кнопок этапов на замороженном операторском экране. Код operator* не менялся; исключений для него в F нет. Правило AGENTS.md: «Frozen areas — don't edit, refactor or delete». Для устранения нужен отдельный допуск владельца.

## Воспроизведение замороженного дефекта

На собственном одноразовом PostgreSQL/Redis-стенде, синтетический завершённый оператор из disposable-qa.mjs, /operator, 375×812. В PhaseBar (src/components/piling/operator-mobile/ui.tsx) кнопки имеют rect 44×44, но справа от центра на 21.5px elementFromPoint возвращает следующий li, а не кнопку или её потомка. Перекрывает соединительная линия li::before. Из семи этапов на отдельной диагностике воспроизвелось у первых шести; итоговый F выводит первые четыре подписи. Центр и остальные оси попадают в кнопку. Диагностика повторена после scrollIntoViewIfNeeded и ожидания 100ms, поэтому это не только синхронный скролл метрики.

Доказательство: output/mobile-1023/diagnostics.json и stand/diagnose-targets.log. В коде оператора изменений нет. Исправлять метрику так, чтобы скрыть это перекрытие, нельзя.

## Изменения

- e2e/qa-ac/mobile.spec.ts: выделен readMobileMetrics, hit testing по двум осям 44px, native input/select, строгие 14px без округления. Проверяются padding, псевдоэлемент, круглая кнопка, pointer-events:none, обрезка и скрытое clipped-поле. Вложенная прокрутка восстанавливается после измерений; RED показал scrollTop=112 вместо0, затем добавлено восстановление всех прокручиваемых контейнеров.
- 18 файлов приложения: только className и строка классов dateInput. Подтверждено AST-сравнением после удаления className и нормализации этой единственной строки (class-only.cjs, exit0); бизнес-логика неизменна.
- Классы max-sm ограничивают изменения шириной менее 640px. Для text-2xs/text-3xs сохранены исходные классы и добавлен max-sm:text-sm!, чтобы не сломать существующий глобальный минимум 13px на планшетах/грубом указателе. Общий Button не менялся из-за широкого влияния и frozen-потребителей.
- Файлы/экспорты не удалены. Схема, зависимости, auth/security, operator*, ORION не менялись. Свежий собственный npm ci --ignore-scripts; junction на node_modules/generated не создавался.

Точный numstat кода до коммитов:

~~~text
58	6	e2e/qa-ac/mobile.spec.ts
1	1	src/components/piling/admin-analytics.tsx
1	1	src/components/piling/admin-dashboard-bits.tsx
5	5	src/components/piling/admin-dashboard.tsx
7	7	src/components/piling/admin-dictionaries.tsx
2	2	src/components/piling/admin-equipment/admin-equipment.tsx
5	5	src/components/piling/admin-reports/admin-reports.tsx
7	7	src/components/piling/admin-reports/report-evidence-preview.tsx
3	3	src/components/piling/admin-reports/report-filters.tsx
1	1	src/components/piling/admin-sites/hierarchy-tree.tsx
6	6	src/components/piling/admin-sites/index.tsx
1	1	src/components/piling/admin-users/admin-users.tsx
3	3	src/components/piling/analytics-dashboard/kpi-widgets.tsx
2	2	src/components/piling/equipment-analytics.tsx
1	1	src/components/piling/ops-shell/ops-detail-panel.tsx
1	1	src/components/piling/to/readiness/acting-role-switch.tsx
9	9	src/components/piling/to/readiness/screens/readiness-centre.tsx
2	2	src/components/piling/to/readiness/screens/safety-overview-screen.tsx
7	7	src/components/piling/workspace-settings.tsx
~~~

## Проверки и артефакты

Предшествующие красные прогоны и ошибки harness сохранены, не выданы за успешные. Команды запускались отдельно, коды получены из завершения дочернего процесса (job.cjs или stand.cjs), без pipe в tail/head.

| Команда | Exit | Результат |
|---|---:|---|
| npm run build (собственная одноразовая конфигурация стенда в памяти процесса) | 0 | 95 статических страниц; route types проверены Next |
| npm run lint | 0 | eslint + check-text-integrity |
| node node_modules/@playwright/test/cli.js test --list | 0 | 318 tests / 28 files; исходно 315, добавлен один тест метрики × 3 проекта |
| node node_modules/tsx/dist/cli.mjs scripts/check-layer-boundaries.ts | 0 | границы модулей |

| node node_modules/typescript/bin/tsc --noEmit (после build) | 0 | .next/dev/types отсутствовал, удалять было нечего |
| node node_modules/vitest/vitest.mjs run --maxWorkers=2 | 0 | 5366 passed / 265 skipped / 0 failed; 488 files passed / 15 skipped; 467.94s |

После этих проверок менялось только восстановление прокрутки внутри Playwright-метрики и её регрессионная проверка; приложение не менялось. Для этого файла выполнены отдельный ESLint, tsc и повторный F. Предупреждения сборки: отсутствует опциональный @valkey/valkey-glide в BullMQ и SENTRY_AUTH_TOKEN для публикации source maps; зависимости не менялись. Штатная валидация окружения использовала только собственный одноразовый стенд; .env-файлы не создавались и не копировались.

- Baseline F: 3 failed, по 14 категорий нарушений на браузер; штатный интерфейс до изменений, синтетические данные. Первый сбор тестов дважды дал ноль из-за testMatch/grep; это ошибки harness, а не зелёные прогоны.
- RED метрики: исходный тест неверно отвергал расширенный чекбокс; отдельная регрессия выявила ошибку углов круглой кнопки; clipped-поле 1×1 также воспроизведено RED. После каждого изменения метрики соответствующий GREEN, последний перед восстановлением прокрутки на трёх проектах — 3 passed, exit0.
- Промежуточный полный unit: 5366 passed / 265 skipped / 0 failed. Последний промежуточный scoped: 451 passed, 0 skipped, 0 failed (39 файлов). Они не заменяют финальные проверки после последних CSS-правок.
- GitNexus: полный собственный индекс без parse-cache exit0. readMobileMetrics LOW (2 direct, 0 flows), vis LOW (1 direct). OpsDetailPanel HIGH (9 impacted, 3 direct, 1 flow), предупреждение дано до правок; текстовый поиск подтвердил отсутствие operator-потребителей. Общий Button CRITICAL не менялся. detect_changes all: 23 changed, 33 affected, 19 files, CRITICAL; partial/truncated отсутствуют. Глобальный лимит flow discovery индекса не является доказательством отсутствия остальных связей.

Исходные скриншоты 375×812: output/mobile-1023/before/run/playwright/shots/; промежуточные — intermediate-after и intermediate-second. Финальные — after/run/playwright/shots/. Десктоп 1440×900: desktop-before и desktop-after, dashboard/sites/crews. PNG могут быть в DPR устройства (например, 1125×2436 при CSS375×812). Все сырые логи, JSON и снимки остаются в игнорируемом output/mobile-1023, не в git.

## Ограничения

Физический телефон, production, внешняя резервная копия не проверялись. Браузеры — локальные Chromium, Mobile Safari (WebKit) и Mobile Chrome. Проверены состояния, созданные синтетической фикстурой, а не все динамические диалоги приложения. Unit-пропуски: 263 условных интеграционных сценария и 2 явно отключённых fail-closed S3-теста; их нельзя считать выполненными. No push/merge/deploy.

## Первый финальный прогон и десктоп

f-accept: exit1, 3 passed / 0 skipped / 3 failed, 109.60s. Все три теста метрики проходят, все три F выявляют операторское перекрытие. У Chromium и Mobile Chrome это единственная категория нарушения; у Mobile Safari дополнительно pageerror для /api/readiness/work-permits, shifts, current, defects: access control checks. Это отдельная неразобранная находка, не объявлена «не дефектом» и не отфильтрована. Сырой JSON сохранён как output/mobile-1023/first-accept-results.json.

Десктопный capture: exit0, Chromium 1440×900, dashboard/sites/crews. Сравнение 25+35+15 элементов (геометрия и fontSize) не выявило изменений. Снимки просмотрены: разница динамического времени и аккаунта синтетической фикстуры допустима; пиксельная идентичность не заявляется. AST-проверка изменений классов: exit0.

## Повторный окончательный F и очистка

f-scroll-accept: exit1, 3 passed / 0 skipped / 3 failed, 114.39s. Во всех трёх проектах регрессия метрики, включая восстановление вложенной прокрутки, проходит. Все 12 проверяемых разделов админки не имеют нарушений размеров/шрифтов/горизонтального overflow по F. Общий F остаётся красным из-за frozen operator; Safari access-control pageerror также повторился и остаётся неразобранным. Снимки после восстановления прокрутки повторены и просмотрены.

Команда в собственной обёртке: node output/mobile-1023/qa-after.mjs --grep 'F:|F metric'. Обёртка использует синтетическую disposable-qa.mjs и собственный HTTPS-прокси; все три проекта запускаются с workers1. Итоговый JSON из-за разрешения относительного reporter path фактически расположен в output/mobile-1023/output/mobile-1023/after/results.json; компактная копия — output/mobile-1023/final-playwright-summary.json. Это учтено при чтении настоящих результатов.

После последнего изменения Playwright-файла: ESLint exit0, tsc --noEmit exit0, collection exit0 (318/28), text-integrity exit0. Финальный полный unit выполнен на окончательном коде приложения, его итог не переносится на B/C/G. Условия пропусков: 256 сценариев в15полностью пропущенных файлах; ещё6 real orphan-cleanup требуют INTEGRATION_DATABASE_URL_OWNER + INTEGRATION_DB_CONTAINER, 1 real restore требует OWNER + APP + CONTAINER; 2 it.skip в s3-service.test.ts отключены явно. Всего265. Одноразовые disposable-наборы требуют INTEGRATION_DATABASE_URL_OWNER/APP (HTTP также CODEX_STAND_URL); legacy projection/shifts/work-permits/idempotency/pool/migration требуют DATABASE_URL_POSTGRES, tenant enforcement — DATABASE_URL_APP_ROLE. В обычный unit-процесс эти подключения не передавались. Подробности output/mobile-1023/unit-skip-conditions.json.

Стенд: CLEANUP done, но код обёртки остановки 1, причина ненулевого кода не установлена. Не объявлен успешной проверкой. Независимо подтверждено: собственные PG/дваRedis отсутствуют (docker ps -a exit0), порты50396/51734/51735/51736/51737 закрыты; supervisor32820 и bash364 не найдены. Результат output/mobile-1023/cleanup.json. Production/чужие контейнеры не затронуты.

## Локальные коммиты и передача

- 5727704d8557e8a792747ab7b3cf12e40d6d99c4 — метрика и регрессии, 1файл +58/-6.
- 35062f07c46cfcb499208dc5a87e2d3d7ee1135b — мобильные CSS-классы, 18файлов +64/-64. Код приложения прошёл build/unit до коммита; SHA256 всех проверенных исходников совпал с сохранённым manifest перед коммитами.
- Этот отчёт и ссылка в историческом REPORT.md сохраняются отдельным docs-коммитом. История прежнего REPORT.md не заменялась.

Открытые вопросы: отдельный допуск на исправление перекрытия operator*; разбор повторяющихся pageerror WebKit; причина exit1 остановки обёртки. Без их закрытия K и вся волна не объявлены полностью зелёными. После решения владельца о слиянии нужен общий прогон на одном конечном SHA, в том числе пересечение C/K в equipment-analytics.tsx. Main за время работы изменён извне до8f1d4ee8; ветки не перебазированы и в main ничего не записывалось.
