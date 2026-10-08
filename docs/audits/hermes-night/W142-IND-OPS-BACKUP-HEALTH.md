# W142 — выпуск, резервные копии, восстановление и проверка работоспособности (независимый аудит)

Аудируемая версия: `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01` (merge codex/j9-j8-j7-1007, 2026-10-07).
Рабочее дерево аудита чистое (`git status` пуст), т.е. прочитанное совпадает с коммитом.
Отчёт-приёмник: этот файл. Код, миграции, деплой и команды записи не запускались.

## Итог

- Всего находок: **17** — критично **2**, важно **9**, мелочь **6**.
- Топ-5:
  1. **Ночной дамп не проверяется на восстановимость** — единственный контроль «файл непустой» (`scripts/backup-postgres.sh:47-56`); ни `pg_restore -l`, ни контрольной суммы. Битый/обрезанный дамп проходит как успешный, а алерты смотрят только на возраст.
  2. **Восстановление по документированной процедуре уничтожает права** — `--no-owner --no-privileges` стирает GRANT'ы роли `pilingtrack_app`, а `scripts/restore.sh:212-236` печатает «Verification OK», посчитав только таблицы и строки. В аварии вы восстановите базу, сверите `count(*)`, объявите успех — и получите неподнимающееся приложение (runbook 010 фиксирует 320 → 0 грантов).
  3. **Мониторинг бэкапа можно полностью выключить одной переменной** — пустой `BACKUP_ENABLED` даёт `status:'up', source:'disabled'` (`health-tracker/checkers/backup.ts:77-80`), и все алерты `Backup*`/`OffsiteBackupNotSynced` подавлены гейтом `backup_monitoring_enabled==1` (`observability/prometheus/alerts.yml:375-409`). «Зелёная панель» не значит «бэкап есть».
  4. **`/api/health` (цель HEALTHCHECK и деплой-гейта) не проверяет воркеров, планировщиков, хранилище и бэкап** (`health-checks.ts:164-171`, `Dockerfile:110`, `deploy.yml:110`) — мёртвая фоновая обработка не переводит контейнер в unhealthy и не останавливает выкат.
  5. **GitHub-Actions деплой собирает образы на VPS** (`deploy.yml:78-85`), вопреки решению от 23.09 собирать локально (`deploy-prod.sh:8-12`) — прямая дорога к «no space left on device» на 30-ГБ диске.

## Методика

Первый проход — без чтения старых отчётов `docs/audits/` (сравнение только в Приложении).
Читались только файлы аудируемой версии `wt-audit-0f53` (read-only). Что просмотрено:

- Выпуск: `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `.github/workflows/integration.yml`, `scripts/deploy-prod.sh`, `scripts/replace-worker-generation.sh`, `docs/runbooks/008-manual-deploy.md`, `docs/runbooks/007-github-actions-deploy.md`, `docs/runbooks/016-release-2026-10.md`, `Dockerfile`, `Dockerfile.workers` (по упоминаниям), `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.monitoring-prod.yml`.
- Бэкап/восстановление: `scripts/backup-postgres.sh`, `scripts/backup.sh`, `scripts/restore.sh`, `scripts/restore-drill.sh`, `scripts/restore-drill-verify.cjs`, `scripts/db-drill-manifest.cjs`, `scripts/test-db-dump.cjs`, `scripts/pitr-basebackup.sh`, `deploy/systemd/*`, `docs/runbooks/006`, `009`, `010`, `013`, `tests/integration/disposable-restore.spec.ts`.
- Health/readiness: `src/app/api/health/route.ts`, `src/app/api/health/deep/route.ts`, `src/app/api/readiness/route.ts`, `src/app/api/liveness/route.ts`, `src/core/observability/health-checks.ts`, `src/core/observability/health-tracker/**` (tracker, aggregate, thresholds, scheduler-registry, checkers/*), `src/workers/unified-worker/health-server.ts`, `observability/prometheus/alerts.yml`, `observability/alertmanager/alertmanager.yml`, `scripts/prod-smoke.mjs`.
- Env/логи/секреты: `scripts/validate-env.ts`, `package.json`, `src/lib/logger.ts`, `src/instrumentation.ts`, `next.config.ts`, `.env.production.example`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `.dockerignore`.

Приёмы проверки: (а) чтение пути целиком, а не по цитатам; (б) сверка «объявлено в доке» ↔ «что делает код»; (в) проверка, что инструмент вывода не искажает секреты — см. ниже.
**Важная методическая оговорка.** Инструменты чтения маскируют секрето-подобные значения в выводе: строка `scripts/disk-guard.sh:59` показывалась как `Bearer ***`, `docs/runbooks/014-post-deploy-2026-10.md:263` — как `$ALERT...OKEN`. Проверка `node -e "...replace(/[A-Za-z0-9]/g,'x')"` показала, что реальное содержимое — рабочие конструкции (`-H "Authorization: Bearer $token"`), т.е. это артефакт маскировки вывода, а не баг. Поэтому «секрет в коде» я не заявляю нигде, где не убедился в этом отдельно.

## Таблица процессов выпуска

| Шаг | Файл | Что проверяется | Статус |
|---|---|---|---|
| Триггер | `.github/workflows/deploy.yml:5-21` | ручной `workflow_dispatch`; требуется подтверждение `external_workers_stopped` | работает |
| Барьер внешних воркеров | `deploy.yml:35-41`; `scripts/deploy-prod.sh:49-53`; `scripts/replace-worker-generation.sh:64` | подтверждается **человеком**; helper видит только локальный docker-проект | автоматически не проверяемо (см. Не проверено) |
| Git | `deploy.yml:57-68` | HEAD = origin/main; ставится один набор rollback-тегов | работает |
| Сборка | `deploy.yml:78-85` (на VPS) / `deploy-prod.sh:82-91` (локально) | smoke-образ воркеров (`smoke-workers-image.sh`) | два разных пути, см. находку 6 |
| Миграции | `deploy.yml:70-77`; `deploy-prod.sh:76-80` | при новых миграциях `migrate` добавляется в сборку автоматически | работает |
| Переключение | `replace-worker-generation.sh:109-130` | STOP → VERIFY (exit/OOM/RUNNING) → START; авто-возврат старого поколения при отказе | работает |
| Проверка | `deploy.yml:104-125` (только `/api/health` + версия) / `deploy-prod.sh:124-139` (health, код `/api/health/deep`, миграции) | версия `APP_VERSION`, healthy контейнеров | тело `deep` не разбирается — см. находки 4, 5 |

## Таблица резервного копирования и восстановления

| Что | Файл/юнит | Где лежит | Проверка восстановимости | Статус (по репозиторию) |
|---|---|---|---|---|
| Ночной логический дамп | `scripts/backup-postgres.sh`; `deploy/systemd/pilingtrack-backup.timer` (`OnCalendar=*-*-* 03:30:00`, `RandomizedDelaySec=10min`), retention 30 дней | `/var/backups/pilingtrack/*.sql.gz` на VPS | **нет** — только «файл непустой» (`:52-56`) | заявлено как рабочий; на сервере не проверялось |
| Off-site копия | `scripts/backup-postgres.sh:89-128` (rclone → R2 `db-backups/`) | Cloudflare R2, тот же бакет/ключ, что media (если `BACKUP_S3_*` не заданы) | нет; сбой копии — только warning | заявлено |
| Метрики + алерты бэкапа | `backup-postgres.sh:144-169` → Redis `pilingtrack:system:backup:*`; `health-tracker/checkers/backup.ts`; `alerts.yml:374-416` | Redis state | проверяется только **возраст**, не читаемость | включается лишь при `BACKUP_ENABLED` (гейт) |
| Восстановление (прод) | `docs/runbooks/006-postgres-backup-restore.md:82-119` | VPS | count таблиц; гранты не восстанавливаются | ручная процедура |
| Репетиция (стенд) | `docs/runbooks/010-restore-drill.md` | локальный Docker-Postgres | count таблиц/строк, миграции, RLS; явно зафиксировано, что гранты теряются (`:86-130`) | есть «Журнал учений» (17.07, 13.08, 15.09, 27.09.2026) — документ, независимо не подтверждён |
| CI-учение (синтетика) | `tests/integration/disposable-restore.spec.ts`; `.github/workflows/integration.yml:67`; `scripts/restore-drill.sh`, `test-db-dump.cjs`, `restore-drill-verify.cjs` | одноразовый Postgres 16 в CI | авто: сверка sha256 дампа, счётчиков всех таблиц, миграций, RLS, ролей и fail-closed | воспроизводимо, но на **синтетическом** дампе, не на боевом |
| Недельный basebackup | `scripts/pitr-basebackup.sh`; `deploy/systemd/pilingtrack-pitr-basebackup.timer` | `/opt/pilingtrack/basebackups` | не проверялся | есть |
| PITR | выключен: `docker-compose.prod.yml:101` (`archive_mode=off`) | — | — | недоступен с 24.06.2026 |

## RPO / RTO

| Показатель | Значение | Измерено или заявлено |
|---|---|---|
| RPO | до ~24 ч (+ джиттер до 10 мин) | **выведено арифметически из расписания** (`deploy/systemd/pilingtrack-backup.timer:5-7`), не измерено на инциденте. PITR выключен (`docker-compose.prod.yml:101`), секундного RPO нет |
| RTO (боевая база) | — | **не измерено.** Есть только стенд 27.09.2026: `≈11 с` от дампа до приложения при базе 22 МБ (`docs/runbooks/010-restore-drill.md:146,185`), без времени скачивания дампа и наката грантов |
| SLA в ранбуках | «Restore < 30 min» (`runbook 006:5`), «< 60 min» (`runbook 009:31`) | **заявлено** как цель; числа 009 сам помечен как недоступный |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `scripts/backup-postgres.sh:47-56` | Дамп пишется `pg_dump -F c | gzip`, а проверяется только `[ ! -s "$OUT" ]` — нет `pg_restore -l`, нет sha256 в метаданных (в legacy `scripts/backup.sh:127-140` такая проверка есть) | Обрезанный или битый архив числится успешным заданием; алерты смотрят на возраст (`alerts.yml:384-404`), а не на читаемость. О негодности узнаём в момент аварии | После записи: `pg_restore -l "$OUT" >/dev/null` и/или sha256 в Redis-метаданные; при непрохождении — ненулевой код |
| 2 | критично | `docs/runbooks/010-restore-drill.md:86-130`; `scripts/restore.sh:195-203,212-236` | Восстановление идёт `--no-owner --no-privileges`, что выбрасывает все `GRANT` роли `pilingtrack_app`; `verify_restore` считает только таблицы и строки для ключевых таблиц и печатает «Verification OK» | В реальной аварии база «восстановлена», `count(*)` сходятся, приложение не может подключиться (`permission denied`); отладка грантов — под нагрузкой инцидента | Обязательный шаг наката `scripts/app-role-grants.sql` + `identity-role-grants.sql` и негативный тест «0 строк, а не permission denied» (шаги уже описаны в `010:104-130` — перенести в сам скрипт) |
| 3 | важно | `src/core/observability/health-tracker/checkers/backup.ts:77-80`; `docker-compose.yml:129`; `observability/prometheus/alerts.yml:375,386,397,409` | Пустой `BACKUP_ENABLED` → `{status:'up', source:'disabled'}` без возраста; все алерты бэкапа гейтятся `backup_monitoring_enabled==1`. В compose переменная пробрасывается пустой по умолчанию | Одна невыставленная переменная в `/opt/pilingtrack/.env` полностью выключает и метрики, и алерты: панель «зелёная», а копий может не быть. Обнаружить это без ручной проверки нечем | Считать «disabled» отдельным тревожным состоянием (метрика + алерт `BackupMonitoringDisabled`), а не тихим `up` |
| 4 | важно | `src/core/observability/health-checks.ts:164-171`; `src/app/api/health/route.ts:34-37`; `Dockerfile:110`; `.github/workflows/deploy.yml:110` | `/api/health` проверяет только БД, память, env, диск и Redis; воркеры, планировщики, хранилище и бэкап не входят. Один и тот же эндпоинт — HEALTHCHECK контейнера и гейт выката | Умерший встроенный `outbox`/`projection`-worker в контейнере app не переводит его в unhealthy и не вызывает рестарт; выкат объявляется успешным при мёртвой фоновой обработке | Добавить проверку воркеров/планировщиков в `getHealth()` либо явно требовать `/api/health/deep` перед выкатом |
| 5 | важно | `src/app/api/health/deep/route.ts:40-57` vs `src/core/observability/health-tracker/aggregate.ts:19-31`; `scripts/prod-smoke.mjs:88-97` | HTTP-код `deep` считается по 7 компонентам (включая `workers`, `outbox`, `backup`), а тело перечисляет только `database`, `redis`, `schedulers`, `storage`. `prod-smoke` перебирает `components` и вообще не увидит `workers`/`outbox`/`backup` (там же устаревший комментарий про компонент `websocket`) | Мониторинг получает 503 без указания причины; деплой-смоук рапортует «все зависимости ok», пока маршрут в unhealthy | Экспонировать `workers`/`outbox`/`backup` в теле `deep` (или в логе снимка) и починить список в `prod-smoke` |
| 6 | важно | `.github/workflows/deploy.yml:78-85`; `scripts/deploy-prod.sh:8-12` | Workflow собирает `app`/`workers`/`migrate` на VPS в 30 ГБ диска (последовательно, с `builder prune`), хотя `deploy-prod.sh` существует именно потому, что сборка на VPS доводила диск до 100 % | Параллельная/повторная сборка может съесть диск рядом с работающей базой; `prune` в workflow может, наоборот, удалить rollback-образы | Перевести workflow на локальную сборку + `docker save | ssh docker load`, как в `deploy-prod.sh` |
| 7 | важно | `scripts/restore.sh:251-264`; `scripts/backup.sh:213-216` | Процедура восстановления печатает инструкции `kubectl scale deployment pilingtrack-prod-api` — в проекте нет Kubernetes | При инциденте оператор получает невыполнимые команды вместо `docker compose` | Заменить на проектные `docker compose stop/up` (как `runbook 006:86-119`) |
| 8 | важно | `src/app/api/orion/lead/route.ts:83,100` | В лог уходит `{ name, contact, message }` — имя, контакт и текст обращения: персональные данные в журнале приложения (Loki). Файл входит в замороженную зону ORION (`AGENTS.md`) | 152-ФЗ: ПДн в логах, доступных вне БД; логи уходят и в сборщик | Не логировать содержимое (или маскировать); правку согласовать с владельцем — зона заморожена |
| 9 | важно | `src/core/observability/health-tracker/checkers/backup.ts:23-31`; `.../thresholds.ts:14`; `docker-compose.yml:60-146` | Файловый фолбэк бэкапа читает `/backups/pilingtrack/daily` внутри контейнера app; каталога там нет — у сервиса `app` не объявлено ни одного `volumes:`, а на хосте дампы лежат в `/var/backups/pilingtrack` | При отсутствии ключей в Redis состояние всегда `source:'missing'`, реальный возраст не читается — фолбэк недостижим | Либо смонтировать каталог бэкапов в app, либо убрать недостижимый фолбэк и явно сообщать «нет данных» |
| 10 | важно | `docs/runbooks/006-postgres-backup-restore.md:5`; `docs/runbooks/009-pitr-restore.md:31`; `docs/runbooks/010-restore-drill.md:136-160` | Целевые SLA («< 30 min», «< 60 min») подаются рядом с фактическими числами; RPO выведен из расписания таймера, RTO боевой базы не измерялся ни разу (все учения — на стенде) | Планирование восстановления опирается на заявленные, а не измеренные числа; «11 с» — нижняя граница на базе 22 МБ | Помечать «цель/оценка», провести замер RTO на боевом объёме (план уже есть в `010:162-168`) |
| 11 | важно | `package.json:8,10`; `Dockerfile:119`; `.dockerignore:45-54` | `validate-env.ts` вызывается только в `npm run dev/build/start`; образ запускается через `node server.js`, а каталог `scripts/` вообще исключён из образа. В проде контракт переменных проверяется только на сборке и через `:?`-подстановки compose | Ошибка проброса переменной в контейнер (класс инцидента `DEFAULT_TENANT_ID`) не ловится fail-fast валидатором на старте | Добавить минимальную рантайм-проверку критичных переменных в `src/instrumentation.ts` (`register()`) или в `server.js`-обвязку |
| 12 | мелочь | `.env.production.example:13`; `Dockerfile:26`; `README.md:171`; `docs/deployment.md:47` | `PIN_LOOKUP_SECRET` описан как обязательный, но вход по ПИН-коду удалён 27.09.2026, код переменную не читает, compose её не требует (в `validate-env.ts` её нет) | Секрет генерируют и хранят ради ничего; документация противоречит compose (`Dockerfile:26` — только стаб сборочного этапа, в runner не попадает) | Убрать из доков/примеров или явно пометить как устаревшую |
| 13 | мелочь | `docker-compose.yml:290-293,301,332` | Пароль Redis передаётся аргументом процесса (`redis-server --requirepass`) и в healthcheck (`redis-cli -a $$REDIS_PASSWORD --no-auth-warning`) | Значение видно в `docker inspect` (Config.Cmd/Healthcheck) и в `ps` внутри контейнера; значение секрета в аргументах — тот самый анти-паттерн, что уже разбирали для скриптов | Использовать `REDISCLI_AUTH` из окружения в healthcheck и не выносить пароль в команду |
| 14 | мелочь | `scripts/backup-postgres.sh:107-128` | Отсутствие `rclone` или сбой off-site копии только пишут warning и не влияют на код возврата; при отсутствии четырёх ключей копия молча пропускается | Внешняя копия может отсутствовать, а задание числится успешным; Redis-флаг `s3_synced=false` подхватывается алертом лишь при включённом гейте (см. №3) | Если off-site обязателен — ненулевой код/отдельный алерт при пропуске, а не warning |
| 15 | мелочь | `docs/runbooks/010-restore-drill.md:178` | Ретеншен в R2 не ограничен: на 27.09.2026 «93 ежедневные копии» и растёт | Неограниченный рост числа объектов/стоимости | Политика удаления на стороне R2 или `rclone delete --min-age` в скрипте |
| 16 | мелочь | `.github/workflows/deploy.yml:13-21,69`; `docs/runbooks/007-github-actions-deploy.md:39-42` | Вход workflow предлагает только `app` / `app workers` / `workers`, но переменная `SERVICES` на поведение не влияет — в команде жёстко `SVCS="app workers"` (`:69,101`); ранбук 007 обещает опции с `ws`, которого нет (удалён 26.09, `docs/deployment.md:51`) | Оператор выбирает «workers», а заменяются оба сервиса; документация расходится с фактическим поведением | Привести ранбук и workflow в соответствие (или реально учитывать выбор) |
| 17 | мелочь | `scripts/backup.sh` (весь), `scripts/restore.sh` (весь); `docs/runbooks/013-prod-timers.md:103-105` | В репозитории живут legacy `backup.sh`/`restore.sh` с kubectl-инструкциями и своим форматом каталогов, тогда как на бою работает `backup-postgres.sh` | Два похожих скрипта бэкапа/восстановления — риск запустить не тот (особенно под инцидентом) | Пометить legacy шапкой «не используется на бою» либо удалить после проверки ссылок |

## Не проверено

- **Фактическое состояние боевого сервера** (какие таймеры включены, заданы ли `BACKUP_ENABLED`, `TRUST_PROXY`, `DEFAULT_TENANT_ID`, `DB_IDENTITY_ROLE` в `/opt/pilingtrack/.env`, установлен ли rclone) — нет SSH, репозиторий этого не показывает. Всё, что касается «работает ли это на бою», взято из документов, а не измерено.
- **Поднят ли на бою стек мониторинга** (`docker-compose.monitoring-prod.yml` с Prometheus/Alertmanager) — от него зависят все алерты, включая `Backup*`; не проверено.
- **Журнал учений runbook 010** (17.07, 13.08, 15.09, 27.09.2026) — это документ; независимо подтвердить факт запуска в этом аудите нечем. Восстановление боевого дампа не запускалось (запрещено условием).
- **CI-учение восстановления** воспроизводимо, но работает на **синтетическом** дампе (`test-db-dump.cjs`), а не на боевом: доказывает механизм, не боевые данные.
- **Off-site копия в R2** — не скачивалась и не сверялась.
- **Содержимое логов на сервере** — не читалось; вывод про ПДн (№8) сделан по коду логирования.
- **Механизм провижининга `.env` и секретов на сервере** (как значения попадают в контейнеры, кто и когда ротирует) — вне репозитория.
- **Наличие алерта на «мониторинг бэкапа выключен»** — в `alerts.yml` не найдено; обратного (что на сервере его нет) не проверял.
- **`sendDefaultPii`** проверен только в `sentry.server.config.ts:17` и `sentry.edge.config.ts:12`; конфиг для browser-части (`sentry.client.config.ts`) в этом проходе не открывался.

## Приложение: сравнение

Сравнение сделано **по именам файлов** в `docs/audits/hermes-night/` (содержимое старых отчётов в первом проходе не читалось — требование независимости). Совпадения по темам:

- Тема «мёртвые метрики/нули бэкапа» пересекается с `R56-dead-metrics.md` (имя указывает на метрики бэкапа) — моя находка №3 про гейт `BACKUP_ENABLED` и подавленные алерты, судя по имени, уже поднималась; здесь она подтверждается на `0f53cd01` со ссылками на код и правила алертов.
- Тема переменных окружения пересекается с `R61-env-vars.md` и `R92-env-passthrough.md` — находка №12 (`PIN_LOOKUP_SECRET`) и №11 (валидатор env не работает в рантайме) относятся туда же; №11 (build-only validate-env из-за `node server.js`) в этих именах явно не отражена.
- `R91-changes-since-deploy.md`, `R87-auditlog-stopped.md`, `W4-AUDITLOG-STOPPED.md` — темы аудита/логов; моя №8 (ПДн в логах ORION) с ними соседствует, но касается именной пары `name`/`contact`, а не журнала аудита БД.
- Находки №1 (нет проверки читаемости дампа), №2 (потеря грантов при restore), №4/№5 (слепые зоны health) и №6 (сборка на VPS) — по именам отчётов прямых двойников не видно; возможно, новы для этого каталога.

Полное попарное сравнение с содержимым старых отчётов не проводилось — по условию задания оно ограничено этим разделом.
