# W114 — Пути к файлам и скриптам в ранбуках, которых нет

Только чтение. Ни один ранбук, скрипт или конфиг не изменён. Проверка проведена в worktree
`D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD совпадает с рабочим деревом на момент аудита.

## Итог

- Проверены все 17 файлов `docs/runbooks/*.md` (3481 строка).
- Автоматически извлечено и сверено с репозиторием **194 ссылки** на пути и команды
  (`bash`/`node`/`npm run`/`npx`/`docker compose -f`, явные `scripts/`, `src/`, `prisma/`,
  `docs/`, `deploy/`, `.github/`, плюс бэктик-токены с расширением). Дополнительно — ручной
  проход по всем бэктик-строкам и по ссылкам «файл:строка».
- **Ссылок на отсутствующий в репозитории файл или скрипт — 0.** Все `scripts/...`,
  `src/...`, `prisma/...`, `deploy/...`, `.github/...`, а также все 5 упомянутых миграций и
  19 хешей коммитов существуют.
- `npm run <имя>`: 2 ссылки (`backfill:analytics`, `build`) — оба скрипта есть в `package.json`.
- Severity: **критично 0, важно 1, мелочь 20.**
- Top-5:
  1. `013-prod-timers.md:37,101` — единственный реально несуществующий в репозитории объект:
     systemd-юниты `pilingtrack-docker-prune.service/.timer`. Сам ранбук это фиксирует
     («в репозитории отсутствуют… только на сервере»), но при переустановке сервера с нуля
     таймер не восстанавливается из репо.
  2. `005-websocket-crash.md` — ранбук целиком про сервис `ws`, снятый 26.09.2026; помечен
     шапкой «УСТАРЕЛ», но тело содержит рабочие команды `dc ps ws`, `dc restart ws` и ссылку на
     несуществующий профиль `ws: 384m` в `docker-compose.prod.yml` (`005:107`).
  3. `014:13,14,45,49,464` — ссылки на `alerts.yml` и `prometheus-prod.yml` без пути; реально
     лежат в `observability/prometheus/`. В аварии неочевидно, какой файл править.
  4. `011:97,101,286,304` (и `010:71,183`, `015:5,50,73`) — скрипты названы без `scripts/`:
     `app-role-verify.sql`, `app-role-smoke.ts`, `backup-postgres.sh`, `test-db-up.sh` и др.
  5. `008:3`, `013:35` — ссылки на другие ранбуки/аудиты без каталога
     (`007-github-actions-deploy.md`, `R56-dead-metrics.md`).

## Методика

Инструменты: `read_file`, `search_files`, `terminal` (git-bash), вспомогательные node-скрипты из
scratch-каталога Hermes (в репозиторий не коммитились).

1. Перечислил `docs/runbooks/*.md` (17 файлов) и выписал `scripts` из `package.json`.
2. Автоизвлечение (node, regex): из каждой строки собрал
   - содержимое бэктиков `` `...` ``;
   - фрагменты после `bash`, `sh`, `node`, `source`, `./`, `npx`, `npm run`, `docker compose -f`;
   - токены вида `scripts/…`, `docs/…`, `src/…`, `prisma/…`, `docker/…`, `deploy/…`,
     `.github/…`, а также токены с расширениями `.sh|cjs|mjs|js|ts|tsx|json|sql|yml|yaml|md|conf|toml|env`.
3. Для каждого токена — проверка существования: `fs.statSync` от корня репо и, для ссылок без
   каталога, поиск файла по всему дереву (`find -name`) и по `git ls-files`.
4. Для `npm run <имя>` — проверка ключа в `package.json.scripts`.
5. Отдельные прогоны: (а) сверка регистра — сравнение токенов с `git ls-files` посимвольно;
   (б) поиск файлов, упомянутых по имени, но отсутствующих в дереве, через `find`;
   (в) проверка существования всех хешей коммитов (`git cat-file -e`);
   (г) проверка упомянутых миграций `prisma/migrations/<id>`;
   (д) проверка ссылок на номера ранбуков.
6. Вручную прочитал целиком наиболее «путевые» ранбуки (005, 013, 014, 010, 011) и просмотрел
   контекст каждой подозрительной строки.
7. Серверные пути (`/opt/...`, `/var/...`, `/etc/...`, `/tmp/...`, `$HOME/...`, `R2:…`) и имена
   systemd-юнитов не проверялись на существование (доступа к боевому серверу нет) — вынесены в
   раздел «Не проверено» и в список серверных ссылок.

Команды, которые можно повторить (из корня репо):

```
# все ссылки с каталогом и их существование
grep -rhoE '(scripts|src|prisma|docs|docker|deploy|observability|tests|e2e|\.github)/[A-Za-z0-9._/-]+' docs/runbooks/ \
  | sed 's/[.,)]*$//' | sort -u | while read t; do [ -e "$t" ] || echo "NOTFOUND $t"; done

# npm run и скрипты
grep -rhoE 'npm run [A-Za-z0-9:_-]+' docs/runbooks/ | sort -u

# имена файлов с расширением, которых нет нигде в дереве
grep -rhoE '[A-Za-z0-9_.-]+\.(sh|ts|tsx|cjs|mjs|js|sql)' docs/runbooks/ | sort -u \
  | while read b; do find . -path ./node_modules -prune -o -name "$b" -print | grep -q . || echo "NOWHERE $b"; done
```

## Находки

Таблица ссылок, которые на дату аудита **не резолвятся в репозиторий** либо требуют каталога,
которого в тексте нет. Полный список 194 корректных ссылок не привожу — они все существуют
(см. «Методику» и сводку ниже).

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `docs/runbooks/013-prod-timers.md:37`, `:101` | `pilingtrack-docker-prune.service` и `.timer` упомянуты как боевые таймеры, но в репозитории отсутствуют (нет в `deploy/systemd/`). Ранбук сам это фиксирует («только на сервере») | Владелец переустанавливает сервер по репо — четвёртый таймер (чистка build-кэша/образов, иначе «no space left on device» на 30-ГБ диске) не восстанавливается; 013:107 прямо пишет «по репозиторию восстанавливаются три таймера из четырёх» | Добавить `deploy/systemd/pilingtrack-docker-prune.{service,timer}` в репо (или явно перечислить три `docker … prune`-команды в разделе установки 013) |
| 2 | мелочь | `docs/runbooks/005-websocket-crash.md:13,26,34,37,56,71,78,87` | Ранбук описывает восстановление сервиса `ws` (`dc ps ws`, `dc restart ws`, `dc logs ws`), снятого 26.09.2026 | Если оператор не прочитает шапку «УСТАРЕЛ», он будет запускать команды для несуществующего сервиса; `dc ps ws` вернёт пусто и это можно принять за «упал» | Удалить ранбук либо превратить в редирект на актуальный способ (шапка уже есть, тело вводит в заблуждение) |
| 3 | мелочь | `docs/runbooks/005-websocket-crash.md:107` | Ссылка «задан в `docker-compose.prod.yml` (ws: 384m)» — сервиса `ws` в `docker-compose.prod.yml` нет (проверено: сервисы `app, workers, postgres, redis, pgbouncer, minio, migrate`) | Ложное указание источника лимита памяти; выкладка настроек пойдёт «в пустоту» | Пометить строку как историческую (или удалить вместе с ранбуком) |
| 4 | мелочь | `docs/runbooks/014-post-deploy-2026-10.md:13,14,45,49,464` | `alerts.yml` и `prometheus-prod.yml` названы без каталога | Файлы реально в `observability/prometheus/`. В аварии неочевидно, какой из `alerts.yml` править (в репо один, но пути нет) | Писать `observability/prometheus/alerts.yml` / `…prometheus-prod.yml` |
| 5 | мелочь | `docs/runbooks/011-app-db-role.md:97,101,284,286,304` | `app-role-verify.sql`, `app-role-smoke.ts`, `app-role-grants.sql` — без каталога `scripts/` | Файлы лежат в `scripts/`. Ранбук рассчитан на аварийное исполнение — неполный путь добавляет шаг «где искать» | Дописать `scripts/` |
| 6 | мелочь | `docs/runbooks/010-restore-drill.md:71,183` | `backup-postgres.sh`, `app-role-grants.sql`, `identity-role-grants.sql` — без каталога | То же: реальные файлы в `scripts/` | Дописать `scripts/` |
| 7 | мелочь | `docs/runbooks/015-disposable-integration-restore.md:5,50,73` | `test-db-up.sh`, `backup-postgres.sh`, `disposable-restore.spec.ts` — без каталога | `test-db-up.sh`/`backup-postgres.sh` в `scripts/`, `disposable-restore.spec.ts` в `tests/integration/` | Дописать каталоги |
| 8 | мелочь | `docs/runbooks/008-manual-deploy.md:3` | Ссылка на `007-github-actions-deploy.md` без `docs/runbooks/` | Ссылка-сосед; резолвится только с учётом каталога ранбуков | Писать `docs/runbooks/007-github-actions-deploy.md` |
| 9 | мелочь | `docs/runbooks/013-prod-timers.md:35` | Ссылка на `R56-dead-metrics.md` без пути | Файл в `docs/audits/hermes-night/` | Дописать путь |
| 10 | мелочь | `docs/runbooks/014-post-deploy-2026-10.md:188` | Ссылка на `app-guard.env` без пути — в репозитории такого файла нет | Это серверный `/etc/pilingtrack/app-guard.env`, который создаётся в этом же ранбуке (`:143`). В отрыве от контекста выглядит как отсутствующий файл | Указать полный путь `/etc/pilingtrack/app-guard.env` |
| 11 | мелочь | `docs/runbooks/011-app-db-role.md:132`; `docs/runbooks/012-rls-fail-closed.md:326` | Плейсхолдер-пути: `bash /tmp/скрипт.sh`, `npx tsx scripts/<имя>.ts` | Не проверяемы по определению (шаблон). Не баг, но в аварии их нельзя скопировать как есть | Оставить как есть либо дать пример реального имени |

Пояснение по «важно #1»: это единственная находка из разряда «ссылка на несуществующий в репо
объект». Остальные 20 — неотрицательные (серверные пути, см. ниже) или стилистические
(неполные пути), но при аварийном чтении неполный путь стоит времени.

### Отдельно: серверные пути и создаваемые файлы (проверке существования не подлежат)

Правило 4: это пути, которые ранбук явно описывает как существующие на сервере или создаваемые
руками. Отсутствие файла в репозитории здесь ожидаемо.

- `docs/runbooks/014-post-deploy-2026-10.md:126-131,143,147,176` — `/opt/pilingtrack/scripts/app-guard.sh`,
  `/etc/systemd/system/pilingtrack-app-guard.{service,timer}`, `/etc/pilingtrack/app-guard.env`
  (создаётся `install -m 0600 /dev/null …` на `:143`), `/var/lib/pilingtrack/`.
- `docs/runbooks/009-pitr-restore.md:81-82,193,201,206` — `/opt/pilingtrack/basebackups/`,
  `/var/lib/docker/volumes/pilingtrack_postgres_data/_data/18/docker`, `$PGDATA/postgresql.auto.conf`,
  `$PGDATA/recovery.signal`.
- `docs/runbooks/010-restore-drill.md:24` — `$HOME/.ssh/orionpiling` (ключ, сервер).
- `docs/runbooks/010-restore-drill.md:55,56,57,174`; `docs/runbooks/013-prod-timers.md:35` —
  имена дампов `pilingtrack-YYYYMMDD-….sql.gz` в `/var/backups/pilingtrack/` и в R2 (`db-backups/`).
- `docs/runbooks/015-disposable-integration-restore.md:55,56` — `/tmp/codex-drill.sql.gz` (создаётся в ходе шага).
- `docs/runbooks/014-post-deploy-2026-10.md:257,264` — `/tmp/runbook014-test-alert.json` (создаётся на `:257`).
- `docs/runbooks/006-postgres-backup-restore.md:59`; `docs/runbooks/009-pitr-restore.md:250`;
  `docs/runbooks/001-postgresql-down.md:70` — `/var/backups/pilingtrack/`, `/opt/pilingtrack/wal-archive/`.

### Сводка по ранбукам (автоизвлечённые ссылки / из них отсутствующих в репо)

| Ранбук | ссылок | отсутствует | комментарий |
|---|---|---|---|
| 001-postgresql-down.md | 2 | 0 | |
| 002-redis-down.md | 2 | 0 | |
| 003-data-corruption.md | 4 | 0 | |
| 004-outbox-backlog.md | 2 | 0 | |
| 005-websocket-crash.md | 2 | 0 | ранбук устарел (см. #2, #3) |
| 006-postgres-backup-restore.md | 4 | 0 | |
| 007-github-actions-deploy.md | 1 | 0 | |
| 008-manual-deploy.md | 32 | 0 | |
| 009-pitr-restore.md | 11 | 0 | |
| 010-restore-drill.md | 6 | 0 | |
| 011-app-db-role.md | 10 | 0 | |
| 012-rls-fail-closed.md | 13 | 0 | |
| 013-prod-timers.md | 22 | 0 | юнит docker-prune отсутствует (см. #1) |
| 014-post-deploy-2026-10.md | 38 | 0 | |
| 015-disposable-integration-restore.md | 8 | 0 | |
| 015-encryption-key-rotation.md | 27 | 0 | |
| 016-release-2026-10.md | 10 | 0 | |
| **Итого** | **194** | **0** | |

## Не проверено

- **Состояние боевого сервера.** Существование `/opt/...`, `/etc/...`, `/var/...`, реальных
  systemd-юнитов и бэкапов не проверялось — доступа к серверу нет (запрещено правилами). Ранбук
  013 сам предупреждает, что его таблица — снимок от 29.09.2026, а не текущий статус.
- **Соответствие ссылок «файл:строка» содержимому.** Проверено только, что файл существует
  (например `src/lib/redis-cache.ts:64`, `…/checkers/backup.ts:15-19`, `encryption.ts:79-105`).
  Совпадает ли цитируемая строка с утверждением в ранбуке — не проверял (вне рамок задачи).
- **Хеши/ссылки на коммиты и миграции** проверены на существование (все есть), но не на то, что
  указанный коммит действительно делает описанное в ранбуке.
- **Файлы, генерируемые сборкой** (`src/generated/postgres-client/client.js`, `016:45`) —
  на диске присутствуют, но в git не отслеживаются (генерируются при `npm run db:generate` /
  сборке); в чистом клоне до сборки их не будет. Это ожидаемо, отдельной находкой не считаю.
- **Обоснованность самих команд** (правильность `docker compose -f … -f …`, набор сервисов) не
  входит в задачу — проверялось только существование упомянутых файлов и имён.
