# R68 — под какой ролью БД ходят как `app`, `workers` и `migrate` на бою

Продолжение `T-IDEMP-RLS-CHECK`. Вопрос: воркер на бою — `pilingtrack_app` (RLS
действует) или владелец (обходит RLS)? От этого зависит, что сделает любая
фоновая уборка на строгих таблицах (`Media`, `ReportVersion`, `ReportAudit`):
удалит 0 строк или все.

## Итог

- **критично — 1, важно — 7, мелочь — 5** (всего 13).
- **По репозиторию однозначно определить нельзя.** Репозиторий задаёт только
  формулу: `docker-compose.yml:162-163` берёт `${APP_DB_USER:-${POSTGRES_USER:-postgres}}`.
  Само значение `APP_DB_USER` живёт в `/opt/pilingtrack/.env` — файла нет в git,
  читать его запрещено (AGENTS.md §1). При пустом значении compose **молча**
  подставляет владельца.
- **Что говорит о бое документация** (это запись о живых замерах, а не конфиг
  репозитория): прод переключён 13.08.2026 на `pilingtrack_app`
  (`docs/runbooks/011-app-db-role.md:196,304-306`), `docs/adr/0044-rls-fail-closed-scope.md:101-107`,
  и отдельный замер по живому проду 22.09.2026: «роль приложения на проде —
  `pilingtrack_app`, `rolsuper=f`, `rolbypassrls=f`» (`docs/audit.md:154`).
- **Вывод:** с высокой вероятностью воркер = `pilingtrack_app` → **RLS действует**
  → уборка `Media` / `ReportVersion` / `ReportAudit` без тенант-контекста
  **удалит 0 строк молча** (GUC `app.current_tenant` вне запроса не выставляется,
  `src/core/security/tenant-rls.ts:82-100`).
- **Обратная ветка — цена ошибки:** если `APP_DB_USER` пуст (или строку убрали —
  откат по `docs/runbooks/011-app-db-role.md:272-279` возвращает именно это),
  воркер ходит владельцем-суперпользователем `piling`, который обходит RLS
  **всегда** (`docs/runbooks/011-app-db-role.md:3-13`, `docs/adr/0044-rls-fail-closed-scope.md:74-77`).
  Тогда та же уборка удалит **все** строки. Одна отсутствующая строка в `.env`
  переключает «0» на «всё».
- **Топ-5:** 1) фолбэк на владельца в compose (#1); 2) «0 строк молча» при
  app-роли (#2); 3) ранбук 012 учит, что `DATABASE_URL_POSTGRES` даёт владельца —
  в контейнере это та же app-роль (#3); 4) шаблоны `.env.*.example` без `APP_DB_*`
  (#4); 5) ранбуки 011/012 зовут сервис `ws`, которого больше нет — шаг
  переключения и откат упадут «no such service» (#6).

**ОДНА безопасная команда только-чтения** (запускать на боевом сервере, пароль
не печатается — проверено локально на синтетическом URL: на выходе только имя
роли):

```bash
cd /opt/pilingtrack && docker compose exec -T workers sh -c 'printf %s "$DATABASE_URL"' | sed -E 's#^[a-z]+://([^:@]+):[^@]*@.*#\1#'
```

Ожидаемый вывод — одно слово: `pilingtrack_app` (RLS действует, уборка без
контекста даст 0) либо `piling` (владелец, уборка без контекста снесёт всё).
`psql` в образе воркеров **нет** (`Dockerfile.workers:63` ставит только curl,
tini, openssl), поэтому усиленный вариант — через `pg`, который есть в образе как
боевая зависимость (`package.json:145`). Он отвечает сразу на оба вопроса (роль и
видимость `Media`):

```bash
cd /opt/pilingtrack && docker compose exec -T workers node -e 'const{Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query("select current_user as role,(select count(*) from \"Media\") as media_visible")).then(r=>console.log(r.rows[0])).then(()=>c.end()).catch(e=>{console.log("ERR",e.message);process.exit(1)})'
```

Независимое подтверждение вторым источником (кто реально держит соединения) —
`docker compose exec -T postgres psql -U piling -d pilingtrack -Atc "SELECT usename, count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() GROUP BY 1 ORDER BY 2 DESC;"`
(так предписано в `docs/runbooks/011-app-db-role.md:240-247`).

## Методика

Правок в репозиторий не вносилось, база не поднималась, на прод не ходил.

1. `search_files target=files pattern=docker-compose*.yml` → 6 файлов; целиком
   прочитаны `docker-compose.yml`, `docker-compose.prod.yml`,
   `docker-compose.staging.yml`; по остальным — grep `^  (app|workers):`,
   `DATABASE_URL=`, `POSTGRES_USER` (переопределений env `app`/`workers` там нет).
2. Полностью прочитаны ранбуки `011-app-db-role.md`, `012-rls-fail-closed.md`,
   `013-prod-timers.md`; grep `pilingtrack_app` по репозиторию (80 вхождений) и
   разбор `docs/audit.md:120-199`, `docs/adr/0044-rls-fail-closed-scope.md:74-120`.
3. Скрипты и юниты: `scripts/app-role-grants.sql`, `scripts/app-role-verify.sql`,
   `scripts/staging-local.sh`, `scripts/deploy-prod.sh`,
   `scripts/prod-audit-readonly.sh`, `setup.sh`,
   `scripts/generate-env-docker.ps1`, `scripts/backup-postgres.sh`,
   `deploy/systemd/pilingtrack-backup.service`.
4. Шаблоны окружения: grep `APP_DB|POSTGRES_USER|DATABASE_URL|DB_IDENTITY_ROLE` по
   `.env.docker.example`, `.env.example`, `.env.production.example` (сами шаблоны
   в git, секретов не содержат). Файл `.env` не читал.
5. История git: `git log -S'APP_DB_USER' -- docker-compose.yml` (коммит `4c1fe0d6`,
   17.08.2026), `git merge-base --is-ancestor 4c1fe0d6|a8567732 origin/main`
   (оба уже в `origin/main`), `git show origin/main:docker-compose.yml | grep`
   (в `origin/main` строки `${APP_DB_USER:-…}` есть на :78/:79/:162/:163/:242).
6. Путь запроса: `src/lib/db.ts:76-114`, `src/core/security/tenant-rls.ts:50-100`,
   `src/lib/tenant-iteration.ts:22-38`,
   `src/core/media/media-service.ts:436-459`,
   `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:1-56`,
   `src/modules/readiness/application/backfill/backfill-service.ts:1-45`.
7. Состояние RLS: миграции `20260819120000_rls_fail_closed_all/migration.sql:1-60`,
   `20260903000000_rls_remaining_tables/migration.sql:175-204`,
   `20260702000000_drop_stray_rls_tenant_outbox/migration.sql:10-12`.
8. Команды из блока «Итог» прогнаны локально на синтетических URL через bash
   (проверка, что печатается только имя роли и маскированная строка подключения).
9. Проверки §6 AGENTS.md (`tsc`, `lint`, `test:unit`, `playwright --list`,
   `build`) **не запускались**: задача только на чтение, код не менялся.

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | что предложить |
|---|---|---|---|---|---|
| 1 | критично | `docker-compose.yml:162-163` (+`:78-79`, `:242`) | Роль рантайма задаётся только переменной `APP_DB_USER`; при пустом значении подставляется `${POSTGRES_USER}` — на бою владелец-суперпользователь `piling` | Это и есть ответ на вопрос R68: по репозиторию роль **не определена**, определена только формула. Ничто в git не мешает воркеру ходить владельцем, а это меняет поведение уборки на строгих таблицах с «0 строк» на «все строки» (суперпользователь обходит RLS всегда, `docs/runbooks/011-app-db-role.md:3-13`) | Не подставлять владельца как умолчание: `docker compose` должен падать без непустого `APP_DB_USER`/`APP_DB_PASSWORD` (как это уже сделано для пароля `POSTGRES_PASSWORD:?`). Плюс логировать `current_user` при старте воркеров |
| 2 | критично | `src/core/security/tenant-rls.ts:82-100` + `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:1-16,55` + `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:182-194` | Под ролью `pilingtrack_app` GUC тенанта выставляется только при известном тенанте (`if (!tenantId) return query(args)`); у фоновых путей тенанта нет. Политики на `Media` и на `ReportVersion`/`ReportAudit` — строгие (ENABLE + FORCE), без GUC сравнение даёт NULL | Любая уборка на этих трёх таблицах из воркера без тенант-контекста вернёт **ноль строк и не бросит ошибку** — «тихо удалила 0». У существующего `Media.runRetention()` (`src/core/media/media-service.ts:439-450` через `getDbClient()` без контекста) сегодня именно это поведение | Уборку писать внутри тенант-транзакции по каждой организации — готовый приём `forEachTenant` (`src/lib/tenant-iteration.ts:22-38`), как в `pm-scheduler`/`readiness-scheduler`; и логировать «нашли N / удалили M», чтобы ноль не читался как «нечего удалять» |
| 3 | важно | `docs/runbooks/012-rls-fail-closed.md:199-204` против `docker-compose.yml:79,163` | Ранбук учит: подменить `DATABASE_URL="$DATABASE_URL_POSTGRES"`, потому что «скрипт ходит в базу напрямую, и под ролью приложения строгие политики не отдадут ему ни строки». Но `DATABASE_URL_POSTGRES` в контейнерах `app`/`workers` собирается из **того же** `APP_DB_USER`: меняется пул → прямое соединение, а не роль | Автор будущей уборки, скопировав этот приём, получит не владельца, а app-роль, снова увидит 0 строк и решит, что RLS обойдён. Проверка в ранбуке относится к локальному `.env`, а не к контейнеру | Переписать пояснение: в контейнере обе переменные — app-роль; владельца даёт только подключение из контейнера `postgres` или `-U piling` в нём |
| 4 | важно | `.env.production.example:3-5`, `.env.docker.example:2-4` | В обоих шаблонах есть `POSTGRES_USER`/`DATABASE_URL_POSTGRES`, но нет ни одной `APP_DB_*`; в `.env.docker.example` владелец вообще `postgres` | Свежая установка по шаблону (и любой перегенератор `.env`) даёт рантайм под владельцем-суперпользователем — ровно состояние, которое ранбук 011 закрывал; расхождение с документацией не видно ни в одном гейте | Добавить `APP_DB_USER`/`APP_DB_PASSWORD` в оба шаблона с комментарием, что без них рантайм ходит владельцем |
| 5 | важно | `setup.sh:59-60` | Рекомендованный в самом репозитории способ проверки — `docker exec pilingtrack-app printenv DATABASE_URL` | Печатает строку подключения целиком, вместе с паролем роли приложения: секрет попадает в терминал, scrollback и любой сохранённый журнал сессии. Для проверки роли пароль не нужен | Заменить на разбор без секрета: `docker compose exec -T app sh -c 'printf %s "$DATABASE_URL"' \| sed -E 's#^[a-z]+://([^:@]+):[^@]*@.*#\1#'` |
| 6 | важно | `docs/runbooks/011-app-db-role.md:175,214,265,276`, `docs/runbooks/012-rls-fail-closed.md:107,119` | Ранбуки зовут сервис `ws` (`docker compose up -d pgbouncer app workers ws`), но сервиса больше нет: удалён 26.09.2026 (коммит `a8567732`, в `origin/main`), в `docker-compose.yml` сервисов 11 и `ws` среди них нет | Compose на неизвестный сервис завершается ошибкой «no such service: ws». Точка срабатывания — этап переключения роли и откат, то есть момент, когда времени разбираться нет. В ранбуке 012:107 по этой же причине неверна и «ожидаемая» цифра `grep -c DB_IDENTITY_ROLE` = 3 | Убрать `ws` из команд и пересчитать ожидаемые счётчики; заодно проверить таблицу ролей в `011:24-29` |
| 7 | важно | `docs/runbooks/012-rls-fail-closed.md:290-297` против `docs/runbooks/011-app-db-role.md:3-13` и `docs/adr/0044-rls-fail-closed-scope.md:74-77` | Два документа противоречат друг другу про одну и ту же роль `piling`: 012 обещает, что под ней `SELECT * FROM "Report"` даст 0 строк (FORCE распространяется и на владельца), 011 и ADR-0044 фиксируют, что владелец на проде `piling` — суперпользователь (`rolsuper=t`) и обходит RLS всегда | Именно из этого противоречия вырастает вопрос R68: оператор при инциденте получает неверное ожидание («данные пропали» вместо «нужно назвать организацию»), а вывод о защите RLS зависит от того, какой из двух документов читать | Развести формулировки: «локально владелец `postgres` — суперпользователь; на проде владелец `piling` — тоже суперпользователь, поэтому `psql -U piling` без GUC видит всё, а FORCE действует только на не-суперпользователей» |
| 8 | важно | `docs/runbooks/011-app-db-role.md:306` + `scripts/deploy-prod.sh:92` | Журнал ранбука фиксирует, что на проде `docker-compose.yml` правился **поверх** коммита `e948467` и «файлы в git не закоммичены»; при этом выкладка делает `git pull -q origin main` в том же файле | Репозиторий не описывает то, что фактически лежит на бое: состав сервисов и переменных может отличаться от прочитанного здесь. Пока это не подтверждено, любой вывод о бое (включая роль воркера) опирается на документацию, а не на конфиг | Сверить на сервере `git -C /opt/pilingtrack status --porcelain docker-compose.yml` и `git diff -- docker-compose.yml`; расхождения либо закоммитить, либо откатить |
| 9 | мелочь | `scripts/generate-env-docker.ps1:45-52` | Строки `APP_DB_USER`/`APP_DB_PASSWORD` в генераторе закомментированы, с честным предупреждением, что перегенерация файла на работающем контуре молча вернёт рантайм на роль-владельца | Регресс делается одной командой `setup.bat`/`setup.sh` и ничем не ловится: приложение поднимется, health зелёный, RLS перестанет действовать | Раскомментировать после первого `migrate` (как и написано в самом файле) либо валить генерацию, если роль уже существует |
| 10 | мелочь | `scripts/deploy-prod.sh:99-114` | Проверка после выкладки смотрит здоровье контейнеров, `/api/health`, `/api/health/deep` и применённые миграции, но **не** роль БД | Тихий откат на роль-владельца (пустой `APP_DB_USER`, потерянный `.env`) проходит выкладку зелёной: снаружи всё работает, RLS выключен | Добавить в блок проверки одну строку: `usename` из `pg_stat_activity` (как в ранбуке 011:240-247) и печатать её в вывод деплоя |
| 11 | мелочь | `scripts/backup-postgres.sh:48`, `deploy/systemd/pilingtrack-backup.service:8,14` | Хостовые таймеры ходят в базу ролью `POSTGRES_USER`, то есть владельцем (это ожидаемо для `pg_dump`: без прав владельца дамп неполный) | Прямой уборки там нет, но это готовая площадка: если будущую чистку `Media`/`ReportVersion`/`ReportAudit` повесить на хостовый таймер вместо воркера, она пойдёт владельцем и удалит все строки — а воркер под app-ролью в это же время удалил бы 0 | В шапке `docs/runbooks/013-prod-timers.md` зафиксировать правило: удаление боевых строк — только из воркера, под app-ролью и в тенант-контексте |
| 12 | мелочь | `docker-compose.monitoring-prod.yml:105` | Экспортёр метрик подключается владельцем: `DATA_SOURCE_NAME=postgresql://${POSTGRES_USER}:…` | Уборки не делает (только чтение статистики), но это ещё одна точка, где в окружении лежит пароль владельца; при разборе «кто ходит владельцем» она даёт лишние строки в `pg_stat_activity` и мешает проверке №10 | Завести отдельную read-only роль для экспортёра либо явно задокументировать это исключение |
| 13 | мелочь | `Dockerfile.workers:59-63,99` | В образе воркеров нет `psql` (только curl, tini, openssl), а предложенная в задании проверка предполагает `psql` из контейнера воркеров | Команда «SELECT current_user из контейнера workers через psql» невыполнима как написано — при попытке в момент разбора инцидента это стоит времени. `pg` в образе есть (`package.json:145`), так что проверка возможна через `node -e` | Взять готовую команду из «Итога» (и добавить её в ранбук 011 как штатный способ ответа на вопрос «под какой ролью воркер») |

## Не проверено

1. **Фактическая роль воркеров на бою не измерена.** Файл `.env` не читал
   (AGENTS.md §1), на прод не ходил — команд из «Итога» не выполнял. Вывод
   «вероятно `pilingtrack_app`» опирается на журнал ранбука 011 и замер
   `docs/audit.md:154`, то есть на записи о прошлых проверках, а не на
   собственное измерение.
2. **Что реально лежит на бое в `docker-compose.yml`.** Ранбук
   (`011:306`) прямо пишет, что файл правился поверх коммита и не закоммичен;
   сверку не делал (см. #8). До этой сверки состав сервисов на бое (в том числе
   наличие `ws`) остаётся неизвестным.
3. **Состояние RLS на живом Postgres не снимал.** `pg_class.relrowsecurity`,
   `relforcerowsecurity` и `pg_policies` не измерялись — выводы о строгости
   политик взяты из текстов миграций.
4. **«Удалит 0 / всё» в штуках не посчитано.** Сколько строк в `Media`,
   `ReportVersion`, `ReportAudit` на бою — в репозитории нет.
5. **Усиленная команда (`node -e` с `pg`) не выполнялась** — боевого контейнера
   под рукой нет. Наличие `pg` и точка его подключения проверены по репозиторию
   (`package.json:145`, `src/lib/db.ts:98-107`); проверена локально только первая,
   shell-версия (маскирование строки подключения).
6. **Не проверял** `docker-compose.monitoring-standalone.yml` и
   `docker-compose.observability.yml` на предмет переопределения env сервисов
   `app`/`workers`: по grep `^  (app|workers):` их там нет, файлы целиком не читал.
