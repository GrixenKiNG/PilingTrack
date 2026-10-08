# Стратегия PilingTrack на 90 дней — 2026Q4

Дата: 02.10.2026. Горизонт: 02.10–30.12.2026. Срез потока 1: `eada5e1f`, исходная база `0ea0c6be`. Документ CODEX-S1.

Главная цель — сохранить доказуемый учёт работы «Ориона» при отказах связи, фоновых обработчиков и инфраструктуры. Первые изменения устраняют ложные сигналы здоровья, гонки аренды лидера и наложение фоновых проходов; затем закрываются пробелы восстановления и пользовательских сценариев.

## 1. Решения владельца и границы доказательств

- Единственная компания — «Орион», решение от 26.09.2026. Код многоарендности сохраняется. Возврат к вопросу SaaS — 24.11.2026; работы для второго клиента до этого не планируются.
- Outbox с проекциями, второй Redis и PgBouncer сохраняются. Архитектуру к малому масштабу не упрощаем; признанный потолок качества — 8.5/10.
- Производство: один VPS, 30 ГБ диска и 3.8 ГБ ОЗУ. Эти параметры заданы владельцем; текущая загрузка сервера здесь не измерялась.
- Выкладка только по команде владельца через `scripts/deploy-prod.sh`. Codex не выполняет SSH, deploy, push и подключения к production DB.
- Экраны машиниста и их варианты, модуль operator-mobile, сайт ORION — заморожены. Auth/security/tenancy, schema, зависимости и прочие ограничения действуют согласно заданию; разрешение этапа 2 на миграции не означает разрешение менять любые защищённые области.
- Codex отвечает за сложную диагностику и инфраструктуру; Hermes получает небольшие задачи с whitelist; Claude принимает результат; владелец принимает бизнес-решения и выполняет эксплуатационные действия.

Изучены структура исходников, тестов, CI, Dockerfile/compose, источники данных, ADR и runbooks; инвентаризированы заголовки и итоговые находки всех 90 аудитных документов. Подозрительные классы дополнительно сверены с текущими исходниками. Это не повтор всех 90 аудитов и не полный browser/security/load review. Наличие старой находки в Markdown не означает, что она открыта сегодня. Прод, секреты и реальные пользовательские сессии не проверялись.

В `docs/` есть 90 audit-файлов, 14 runbooks, 20 ADR-файлов включая README/template, 32 plan-файла и 47 archive-файлов. Основные повторяющиеся темы: целостность записи и проекций; транзакционный клиент/контекст; наблюдаемость фоновых задач; роль и ограничения реальной БД; выгрузки и смысл цифр; офлайн-ошибки; доступность/мобильная вёрстка; рост данных и воспроизводимость эксплуатации. Severity из разных аудитов нельзя складывать: выборки пересекаются, ряд пунктов исправлен, некоторые относятся к frozen-вариантам.

## 2. Текущее состояние по шести измерениям

Оценки ниже — экспертные ориентиры 0–10 для расстановки приоритетов, а не измеренная метрика, сертификат безопасности или среднее тестового покрытия. Изменение оценки требует новых фактов и приёмки Claude.

| Измерение | Оценка | Доказательства | Ограничение / ближайшая цель |
|---|---:|---|---|
| Корректность | 7.0 | Independent consumers: `src/services/reports/outbox-publisher.ts:78–105,244–255`; chain ID fallback: `src/modules/readiness/infrastructure/audit/append-audit.ts:40–61`; source/report projection tests. Equipment stats пропускают отчёт без аналитики: `src/modules/equipment/application/queries/equipment-query.service.ts:90–115`. | 7 baseline failures и постоянные readiness skips не устранены. I01 измеряет реальный хвост, I05 устраняет/показывает неполноту. |
| Безопасность | 7.5 | CI app-role и интеграции: `.github/workflows/ci.yml:154–155,197–236`; fail-closed ADR: `docs/adr/0046-rls-fail-closed.md`; app role `NOSUPERUSER NOBYPASSRLS`: `scripts/app-role-grants.sql:73–74`; `_prisma_migrations` закрыта приложению: `scripts/app-role-grants.sql:103`. | Сторож маршрутов не заменяет runtime RBAC/RLS/CSRF. Результаты потока 2 требуют независимой приёмки и переноса; изменения auth не поручаются Hermes. |
| Соответствие масштабу | 8.0 | Outbox решение: `docs/adr/0002-outbox-vs-kafka.md:24–38`; Redis state/noeviction и cache/allkeys-lru: `docker-compose.yml:276–299,313–330`; workers runner: `Dockerfile.workers:59–99`. | Ограничены память и диск одного VPS. I11 даёт числовой бюджет без удаления доказательств и смены архитектуры. |
| Сопровождаемость | 6.5 | На срезе после N: 1230 TS/TSX-файлов без generated, 41 >500 физических строк, из них 32 production и 9 test. `docs/DATA-SOURCES.md:4,10` содержит старые размеры графа/моделей; 90 аудитов требуют реестра актуальности. | I09 связывает finding→исправление→проверку; I10 актуализирует конкретные тексты и документы. Массовые split/refactor не планируются. |
| Пользователь | 7.0 | Partial readiness failures видимы: `src/components/piling/to/to-module.tsx:259–267,487–498`; equipment load toast: `src/components/piling/report-form/use-report-form.ts:179–188`; подпись шагов процедуры: `src/components/piling/to/readiness/screens/readiness-centre.tsx:678,685`. | Browser workflows и телефоны не проверены этим документом. Settings GET failures ещё говорят о сохранении: dictionaries65/76, integrations42/48, roles93/99/108/114. I10/I12. |
| Эксплуатация | 6.5 | Smoke/CI N1/N5, метрики N8; независимый host guard и ручное применение: `docs/runbooks/014-post-deploy-2026-10.md:4–19,110–184`; историческое restore-учение: `docs/runbooks/010-restore-drill.md:174–190`. | Projection lag остаётся копией publication lag: `src/core/observability/lag-monitor.ts:161–165,240`. Установка/reload/TLS/off-site/media и полный live RTO не подтверждены здесь. I01/I07/I12. |

### 2.1. Проверки и цифры: не смешивать разные срезы

| Срез / проверка | Фактический результат | Что это доказывает |
|---|---|---|
| Исходный `0ea0c6be`, полный unit | 2636 passed, 7 failed, 60 skipped; exit 1 | Исходный набор не зелёный. Ошибки в `src/services/reports/__tests__/daily-summary.test.ts`, без DB env. |
| Полный unit после N, до двух последних Compose-resolver тестов | 2683 passed, 7 failed, 60 skipped; exit 1. 310 файлов: 301 passed, 1 failed, 8 skipped. | Успех новых guards не устранил исходные 7 failures. Финальный прогон после S3 записывается отдельно в `CODEX-REPORT.md`. |
| Lint после N | exit 0, 7 baseline warnings | Нельзя писать «0 warnings». |
| TypeScript / focused N guards | Root сообщил exit 0 до каждого N-коммита; новые N1/N2/N3/N8/N5: 8/14/6/17/2 теста, затем 2 resolver regression | RED→GREEN отдельных изменений, не evidence всего workflow CI. |
| Playwright collection исходного среза | 99 тестов, 11 файлов | Сбор тестов; не запуск сценариев и не browser acceptance. |
| Next build исходного среза | exit 1: отсутствуют `DATABASE_PROVIDER`, `SESSION_SECRET` | Build не подтверждён. Секреты/фиктивные env не добавляются. |
| Coverage config | `vitest.config.ts:65–73`: floor lines24, statements23, functions19, branches19 | Порог конфигурации, не новое измерение фактического покрытия. Coverage в S1 не измерялось. |
| Поток 2, отдельная ветка, сообщение исполнителя | 35 passed, 0 skipped; disposable Postgres: 84 таблицы, 107 миграций, 76 RLS; restore ~13с | Свежая локальная проверка другого потока. Здесь не повторена, не слита и не подтверждает production/off-site/media. |

Повторяемый подсчёт крупных файлов: `rg --files src -g '*.ts' -g '*.tsx'`, исключить `src/generated`, читать UTF-8, убрать завершающий перевод строки через trimEnd() и разделить по CRLF/LF. Крупнейшие baseline: operator-v10 1716, operator-v5 1312, operator-v2 1255, audit-service.test 1217, readiness-centre 1068, audit-service 985. Значительный объём приходится на frozen-варианты; размер файла сам по себе не повод удалять или делить его.

Постоянные skips: `tests/contract/tech-readiness-api.spec.ts:49` — 13; `tests/integration/tech-readiness-write-pipeline.spec.ts:38` — 6; `src/modules/readiness/domain/__tests__/production-contracts.todo.test.ts:80,143` — 20. Остальные DB gates зависят от окружения. Снимать `describe.skip` целиком без сверки API/бизнес-матрицы нельзя. CI уже запускает DB-интеграции и ловит skips выбранных наборов; утверждение «реальных интеграций нет» неверно.

### 2.2. Что уже закрыто и что ещё открыто

| Аудит / класс | Текущий статус и evidence |
|---|---|
| R85: PDF/Telegram global DB внутри транзакции | Исправление `e2e90e13` есть в истории текущей базы. `src/core/notifications/telegram.ts:22,56` использует существующий `runOutsideGucScope`; settings до tx: `src/services/notifications/durable-alert-delivery.ts:33–38`. Повторять tenancy-правку не нужно. |
| R69: webhook всегда200, нет scrape Alertmanager | Полная недоставка теперь503: `src/app/api/alerts/webhook/route.ts:136–144`; scrape имеется `observability/prometheus/prometheus-prod.yml:86`. Частичная потеря ещё возвращает200: webhook133/139–148. |
| 02: silent readiness/equipment load | Закрыто source evidence в таблице качества. Ошибочные GET-тексты settings остаются малой задачей Hermes. |
| R87: обязательные request/correlation IDs для chain CHECK | Fallback добавлен до хэша: `append-audit.ts:40–61`. Старые audit-строки/согласованность chain head этим не доказаны. |
| 38: откат моточасов при concurrent cache write | Используется `GREATEST`: `src/modules/equipment/application/commands/meter-reading.ts:108`. Старый overwrite фикс не повторять. |
| 52: проценты плана менялись с периодом | Накопительный факт: `src/services/analytics/site-analytics-service.ts:44–49`, `src/components/piling/admin-dashboard.tsx:273–275`. |
| R50: бесконечный confirm download | AbortController/таймер присутствуют: `src/core/media/media-service.ts:197–205,320`. Это не доказательство резервирования media. |
| R59: задержка проекций, overlap планировщиков | Открыто: lag alias161–165; scheduler callbacks `pm-scheduler.ts:67–94`, `readiness-scheduler.ts:24–53`, `projection-rebuild-scheduler.ts:25–43` не имеют running guard. |
| R59: lease на evictable cache | Открыто: `src/core/infrastructure/leader-election.ts:8,99,126,197`; renew GET140/PEXPIRE143 и release GET201/DEL203 не атомарны относительно смены владельца. |
| R87: best-effort FeedbackEvent loss | Открыто как observability gap: `src/services/audit/audit-service.ts:953–984`, warning979 без счётчика. Это операционная лента, не hash-chain. |
| 35: неполная equipment statistics | Открыто: `equipment-query.service.ts:90–115` take1000 и пропуск missing projection. Draft-status semantics требуют решения владельца. |

N1 `8eee7031`, N2 `265a9c79`, N3 `fdc0c678`, N8 `7307f269`, N5 `29417525` + follow-up `eada5e1f` завершены в локальной ветке. Net diff от базы после N: 14 файлов, +910/-25 (подсчёт root). Workers smoke до контакта с сервером — `scripts/deploy-prod.sh:53–58`; no-next/build/smoke CI — `.github/workflows/ci.yml:79–108`. CI workflow удалённо не запускался в этой работе.

N8 исправляет агрегирование PostgreSQL connections по state (пороги160/190), наблюдение host `/`, включённость worker, stale/missing/disabled backups, состояние/возраст health snapshot. Evidence: `observability/prometheus/alerts.yml:59–73,244–270,313–368`; `src/app/api/metrics/route.ts:106–128`; `src/workers/unified-worker/health-server.ts:45`. Реальный TLS data source не добавлен и остаётся owner acceptance пунктом I12.

## 3. Топ-10 рисков для бизнеса

Вероятность — качественная оценка для ближайших 90 дней при сохранении текущих ограничений, не статистическая частота. Цена — производственное последствие; рубли/стоимость смены должен подтвердить владелец. Отсутствие live-проверки не трактуется как подтверждённый инцидент.

| № | Риск | Вероятность / цена | Основание / снижение |
|---|---|---|---|
| R1 | Отчёт о сваях сохраняется, но аналитика устаревает незаметно | Средняя; высокая: решения диспетчера и сведения заказчику опираются на старый факт | Lag alias `lag-monitor.ts:161–165`; I01/I05. |
| R2 | При аварии восстановленная БД формально есть, приложение/фото недоступны | Средняя; критическая: остановка учёта и потеря доказательств | Runbook010:187–190: роли, секреты, media вне dump. I06/I07/I12. Нельзя писать «restore никогда не проверялся». |
| R3 | Потеря VPS или заполнение диска останавливает учёт | Средняя; критическая: простой всех пользователей | Один VPS30ГБ; `docs/runbooks/013-prod-timers.md:24–43`; PDF job TTL не удаляет файлы. I11/I12. |
| R4 | Двойной лидер повторяет обработку/уведомления | Низкая–средняя; высокая: дубли сообщений и конкурирующие записи | Cache allkeys-lru и неатомарные renew/release, evidence выше. I02; coordinated restart владельцем. |
| R5 | Startup/interval одновременно выполняют планировщик | Низкая–средняя; высокая при длинном проходе: лишняя DB нагрузка, повторные PM уведомления | Три scheduler без guard; I03. Межпроцессная исключительность отдельно не решается. |
| R6 | Часть аварийных тревог не доходит человеку | Средняя; высокая: сбой замечают пользователи, а не мониторинг | webhook считает успехом хотя бы одну доставку; host guard/reload требуют применения. I08/I12. |
| R7 | Сбой связи и неподтверждённый офлайн-сценарий лишает смену надёжного учёта | Средняя в полевой работе; критическая для потерянной смены/спора о сваях | Старые 31/43/R76/R82 описывают frozen operator варианты; актуальный browser сценарий здесь не воспроизведён. I12 проверяет сценарии, изменения frozen UI только по отдельному разрешению владельца. |
| R8 | Неполные totals/draft semantics дают неверное представление о выработке | Средняя; высокая: планирование техники/расчёт с заказчиком | Equipment skips missing analytics115; fleet query194–199 без submitted predicate, legacy status51. I05: owner определяет смысл показателей до изменения фильтра. |
| R9 | Операционная лента теряет событие, действие выглядит бесследным | Низкая–средняя; средняя–высокая: сложнее разбор ответственности | `audit-service.ts:976–984`; I04 сохраняет nonthrow, добавляет сигнал потери. |
| R10 | Ложный допуск/недопуск или нарушение доступа не пойманы mocks/skips | Средняя как непроверенный сценарий; критическая: простой установки или доступ к чужим данным | Readiness skips, реальные DB CHECK отличаются от моков. I06/I12: approve/deny/rollback/role workflows. Сейчас нет доказательства актуальной утечки или ложного допуска на проде. |

Историческое учение 27.09.2026 (`docs/runbooks/010-restore-drill.md:174–185`): восстановлены все84 таблицы и76 RLS-политик; app-role видит172 отчёта своего tenant и0 без контекста; около11с до приложения на стенде. Это сильное evidence восстановления БД того снимка. Время скачивания/подготовки ролей/переключения production и восстановление media в11с не входят.

## 4. Дорожная карта на 90 дней

День = рабочий день исполнителя; оценки включают focused tests и описание, но не ожидание владельца. Порядок внутри потока1: I01 → I02 → I03 → I04; затем только готовые к исполнению пункты. I06/I07 уже выполняет поток2 и не дублируются в S3 потока1.

| ID / окно | Цель в числах | Исполнитель / оценка | Зависимости / критерий «готово» |
|---|---|---|---|
| I01 / дни1–10 | 2 независимых lag/pending сигнала, 1 freshness timestamp; 0 маскировок DB error нулём | Codex, 1–2д | `projected:false` независимо от published/type/retry eligibility, age отcreatedAt, delayed retries входят, poison-after-DLQ отдельно. RED published=true/projected=false, empty/backoff/error; gauges+возрастной alert; stale sample обнаруживается. |
| I02 / дни1–14 | Все3 lease operations используют state Redis; 0 renew/delete чужой аренды | Codex, 2–3д | Existing getter и owner-checked Lua renew/release; NX/PX acquire, TTL/ключи сохраняются. RED смена owner, state unavailable, stop чужой lock; failure снимает leadership. До применения владелец согласованно останавливает все старые workers: mixed cache/state версии дают двух лидеров. |
| I03 / дни7–21 | 3 планировщика: максимум1 активный проход на модуль/процесс | Codex, 1–2д | Module-level running + finally; tenant loops/interval/commands не меняются. Existing sentry tests: blocked first run, tick skipped, resolve/reject/heartbeat failure освобождают guard. Не обещать исключительность между replicas. |
| I04 / дни7–21 | 1 bounded counter без labels, 2 exporters; 0 изменений успеха business action | Codex, 1–2д | `audit_feedback_write_failures_total` в catch FeedbackEvent; actor lookup failure не считается потерей успешной записи. Export app и worker `/metrics` (процессы отдельные), process-local reset documented; existing audit/route/worker tests. Это не durable hash-chain. |
| I05 / дни15–45 | 0 silently omitted reports в equipment30d stats; 1 утверждённый контракт draft/submitted и полноты | Codex + владелец, 3–5д | Владелец выбирает смысл цифр; подтвердить take1000 truncation и period query. Source-derived fallback/explicit incomplete signal с existing tests; fixture без projection не выглядит полным нулём. Tenant predicates и frozen UI не трогать. До business решения фильтр submitted не внедрять. |
| I06 / дни1–30 | Real Postgres critical integrations: 0 skips, app-role deny/own/foreign + rollback | Codex поток2 + Claude, 3–5д | Только собственный disposable codex-*; все migrations, owner seed, app неsuperuser/noBYPASSRLS. 35pass/0skip сообщены потоком2: независимая повторная приёмка и перенос по решению владельца ещё нужны. Новые заготовки не включать массово. |
| I07 / дни1–30 | 1 автоматический drill, равенство counts и migration manifests; 0 контактов с owner DB | Codex поток2 + Claude, 2–4д | Custom dump+gzip, fresh codex-* target, no-owner/no-acl + оба role-grants; сравнить84 current tables,107 migrations,76 RLS из fixture динамически, не hardcode исторические числа. ~13с локально сообщено потоком2, не live RTO. Owner затем проверяет1 реальную off-site копию и media. |
| I08 / дни22–60 | 0 неучтённых partial delivery failures; 1 согласованная retry/idempotency политика | Codex + Claude + владелец, 2–4д | I04/I12; определить допустимость дублей и stable identity. Mixed success/failure fixture, timeout/429, max100 truncation, suppression distinguished; policy и тесты приняты до runtime change. Наивный503 на partial batch создаёт дубли и не считается готовым. |
| I09 / дни1–60 | Реестр всех90 audit документов; первые10 важных findings перепроверены за14д | Hermes + Claude, 3–5д | Каждый finding: historical/open/fixed/not reproduced/owner decision, current file:line/commit/checkdate. Нет blanket closure по наличию коммита; severity не суммируется. H09–H12 и H14. |
| I10 / дни1–45 | 15 small tasks, 3 GET load messages исправлены; 0 новых требований к frozen UI | Hermes, 2–3д + Claude review | S2 H01–H15 с точными whitelist; mutation тексты/403 semantics остаются. Документы проверяют source links, timestamps, actual key prefix и ограничения TTL. Browser GET500/reject для3 settings секций; H15 только если исходные7fail ещё требуют mock isolation. |
| I11 / дни30–75 | 1 disk/memory budget, 1 retention policy; 0 удалений evidence без решения | Codex + владелец, 2–4д | Сначала inventory/dry-run temporary pdf-results vs report attachments; выбрать срок/restore evidence. Проверить peak image build free space и rollback image retention. TTL job1h не является file lifecycle. Одобрение политики предшествует любому delete; compose/инфраструктура не меняется автоматически. |
| I12 / дни15–90 | 1 owner acceptance protocol: 6 role/failure workflows, 1 off-site+media drill, 1 независимый аварийный канал | Владелец + Claude, 2–4д | Применить runbook014 inode-aware Prometheus recreate/reload и app-guard test ДО timer; реальные TLS exporter/source и expiry evidence, не мёртвая метрика. Проверить оператор offline/resume/conflict, dispatcher review, mechanic readiness, admin settings, deny access, restore. ADMIN/DISPATCHER platform роли; не выдумывать пользователей FOREMAN/SAFETY_ENGINEER. Codex локально готовит сценарии, прод проверяет владелец. |

На30-й день Claude сверяет I01–I04/I06/I07 с evidence и открытыми рисками; на60-й — полноту audit registry и принятые бизнес-контракты; на90-й — реальные эксплуатационные сценарии I12. Число коммитов и рост количества тестов не заменяют эти критерии. Предлагаемый RPO: не более24ч для daily DB dump; фактический полный production RTO измерить и утвердить владельцу, заранее11/13с не обещать.

## 5. Делегирование S2 и порядок исполнения S3

S2 создаёт 15 отдельных файлов `docs/strategy/hermes-tasks/H01.md` … `H15.md` только после S1. В каждом: цель, exact whitelist, критерий, проверка, запреты, parent initiative. Темы: H01 dictionaries GET текст; H02 integrations; H03 roles; H04 PDF TTL comment; H05 backup key comment; H06 timers historical snapshot; H07 isolated restore runbook; H08 DATA-SOURCES; H09 R85 status; H10 R87 status; H11 silent failures status; H12 alerts delivery status; H13 publish/project distinction runbook; H14 reproducible quality inventory; H15 daily-summary mocks, если проблема ещё существует. Hermes не получает архитектуру, tenancy, auth, frozen screens или удаления данных.

S3 начинает I01 лишь после S1/S2. Перед каждым изменением — GitNexus impact либо разрешённый владельцем на эту ночь fallback `rg` callers по src/tests/e2e/scripts и diff; перед коммитом — actual tsc/focused tests, meaningful RED→GREEN и detect-changes/fallback. Каждый logical change отдельный commit и обновление `CODEX-REPORT.md`. UNKNOWN не означает safe. Новые helper/general abstractions не нужны там, где три коротких guards решают задачу.

## 6. Что не делать

- Не сокращать outbox/projections/Redis/PgBouncer и не вводить Kafka/Kubernetes ради небольшого масштаба: это против решения владельца и не уменьшает подтверждённые риски.
- Не начинать SaaS/tenant2 до24.11 и не удалять tenancy. Не трактовать platform ADMIN/DISPATCHER cross-tenant доступ как новый дефект.
- Не переписывать frozen operator варианты/ORION и не удалять «дубли», telemetry, роли без пользователей, legacy rollback-компоненты. UI приёмка допускает фиксацию проблем, не самовольную правку.
- Не повышать рейтинги за test count, mocked success или Playwright list. Не называть configured coverage floor измеренным coverage. Не скрывать skips/failures/warnings.
- Не закрывать все findings старого отчёта по одному исправлению. Не превращать ошибки DB/Redis в healthy0; stale/disabled/missing — разные состояния.
- Не включать skipped readiness suites целиком: требуется сверка текущего API, прав и реальной транзакционной границы.
- Не менять shared auth/security/tenancy или production config, не добавлять зависимости и не читать `.env*` ради зелёной сборки.
- Не удалять media/PDF/audit/outbox и не делать DROP/reset/db push без отдельного разрешённого пункта. Retention сначала policy+dry-run+owner acceptance.
- Не обещать сохранность фото на основании DB dump, RTO production на основании13с синтетического drill или применённые alerts на основании git commit.
- Не лечить partial Telegram failure простым retry whole batch без политики дублей; не смешивать old-cache и new-state worker lease в rolling rollout.

## 7. Что требует решения владельца / что остаётся неизвестным

1. Семантика draft/submitted и completeness equipment/fleet KPI, допустимая задержка проекций.
2. Политика повторов частично доставленной пачки Telegram и стоимость пропуска/дубля.
3. Retention temporary PDF, срок хранения attachments/evidence и бюджет свободного диска перед build/rollback.
4. Реальный TLS measurement source, применение runbook014, независимость guard/канала и роли production DB.
5. Off-site/media recovery, полное production RPO/RTO и денежная цена смены/простоя.
6. Приёмка/перенос результатов потока2 и отдельные разрешения на frozen/auth работы, если I12 выявит подтверждённый дефект.

Все live-пункты остаются неизвестными до выполнения владельцем/Claude. Стратегия задаёт безопасную последовательность локальных действий и проверяемые условия готовности; не заменяет итоговый отчёт с реальными exit codes.

## 8. Локальное исполнение дорожной карты на 02.10.2026

Срез оценки выше остаётся eada5e1f. Эта таблица фиксирует последующую локальную работу;
наличие коммита не означает применение на production или приёмку Claude.

| Инициатива | Реализация / проверка | Остаток |
|---|---|---|
| I01 | 1df899d5: projected:false age/count и freshness; focused67pass/0skip | Production query cost, scrape/reload и promtool |
| I02 | d1f38b5a + 35b5ca49: stateRedis, owner Lua, lifecycle и monotonic deadline | Реальный Lua smoke недоступен без Docker daemon; coordinated stop всех old workers владельцем, DB fencing не заявлен |
| I03 | 1a2d340f: максимум один активный pass трёх scheduler в одном процессе; focused37pass | Межпроцессная исключительность не входит в этот guard |
| I04 | 7cf94a71: globalThis process counter и два exporters; focused116pass | Restart сбрасывает счётчик; это не durable hash chain |
| I05 | 1537f517: полный stats30d независимо history cap, missing-only source fallback; focused28pass | Draft/submitted contract, history pagination, существующая stale projection и production query measurement |
| I06/I07 | Отдельный поток codex/integration-1002: 35 realPGpass/0skip, 84tables/107migrations/76RLS restore | Приёмка/перенос Claude, настоящая off-site/media проверка владельца |
| I08 | Runtime retry не менялся | Решение о дублях/idempotency и стабильной идентичности доставки |
| I09/I10 | S2 da6b7077: 15 точных задач H01–H15 подготовлены | Задачи Hermes не исполнены этим потоком; включая исходные семь daily-summary failures |
| I11 | d6550123: ограниченный local flat inventory без удаления и capacity/retention worksheet; focused16pass | Политика владельца, полный S3 inventory, фактический disk/RAM budget, очистка не реализована |
| I12 | Только критерии стратегии/runbook | Production, browser/role/offline/TLS и media/off-site workflows не проверены |

Итоговые проверки потока1: tsc exit0; lint exit0 с7исходными warnings; полный unit повтор
2735passed/7failed/60skipped, exit1. Первый итоговый unit:2734/8/60 с дополнительным
workers health import timeout30с; targeted11/0 и полный повтор его не воспроизвели,
причина таймаута не установлена, настройки не ослаблены. Playwright collection99/11,
exit0; build exit1 на отсутствующих DATABASE_PROVIDER/SESSION_SECRET, до Next build.
Полные команды, строки и ограничения — [CODEX-REPORT.md](../../CODEX-REPORT.md).

### Состояние на 08.10.2026

Сверка 08.10.2026. Каждый хеш проверен командой `git merge-base --is-ancestor <sha> main`;
числа тестов — реальным прогоном, не цитатой из отчёта.

| Пункт | Коммиты / проверка | Результат |
|---|---|---|
| I01–I05, I11 | 1df899d5, d1f38b5a, 35b5ca49, 1a2d340f, 7cf94a71, 1537f517, d6550123 | в main и в выложенной версии b6f51541 (`is-ancestor`: yes) |
| M6–M8 | 276d777b, 65a0d051, 46501848, a4398d65 | в main (`is-ancestor`: yes) |
| M6–M8, доказательство | `scripts/test-m6-m8.sh` на одноразовом Postgres | 5 passed (5), exit 0 |
| Поток 2 Codex (I06/I07) | cfe78d48, e7d3ab55, 96a904c5, 6c84ff00 | влит в main (`is-ancestor`: yes) |
| Интеграционный набор | одноразовый Postgres | RLS 21, restore 3, write-pipeline 5, scripts 18, ci 3 — зелёные |
| H01–H15 | коммиты с пометкой CX-H в main | 13 из 15: H01–H06, H08–H12, H14, H15; H07 и H13 коммитов не найдено |