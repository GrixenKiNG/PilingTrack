# Runbook 011 — роль приложения `pilingtrack_app`

**Зачем.** Приложение, воркеры и ws ходят в базу ролью-владельцем. На проде это
`piling`, и она — суперпользователь:

```
rolname | rolsuper | rolbypassrls
piling  | t        | t
```

Суперпользователь обходит RLS **всегда**; `FORCE ROW LEVEL SECURITY` на него не
распространяется. Поэтому все политики `tenant_isolation_*` на 25 таблицах — и
fail-closed миграция `20260813030000` в том числе — на проде **декоративны**.
Единственная реальная защита от межтенантной утечки там сегодня — прикладной
фильтр (`tenantWhere`).

Задача предписана ADR-0042 п. 7 и зафиксирована в ADR-0044.

**Порядок критичен:** сначала гранты и проверка на восстановленной копии, только
потом переключение прода. Наоборот — приложение встанет на отсутствии прав.

## Что меняется

| Кто | Роль до | Роль после | Зачем |
|---|---|---|---|
| `migrate` (prisma migrate deploy, seed) | `piling` | `piling` | владеет таблицами, ему нужен DDL |
| `app`, `workers`, `ws` | `piling` | `pilingtrack_app` | рантайм; без BYPASSRLS — политики начинают работать |
| `pgbouncer` | `piling` | `pilingtrack_app` | чтобы в контейнере пула не лежал пароль суперпользователя |
| psql руками, бэкапы, восстановление | `piling` | `piling` | без изменений |

Роль `pilingtrack_app`: не владелец, `NOSUPERUSER NOBYPASSRLS NOCREATEDB
NOCREATEROLE`, без `CREATE` на схему `public` (то есть без DDL), с
`SELECT/INSERT/UPDATE/DELETE` на таблицы `public` кроме `_prisma_migrations`.

Три файла делают всю работу:

| Файл | Что делает |
|---|---|
| `scripts/app-role-grants.sql` | заводит роль и выдаёт гранты, идемпотентно |
| `scripts/app-role-verify.sql` | 5 проверок прав + изоляция тенанта под `SET ROLE` |
| `scripts/app-role-smoke.ts` | 8 проверок настоящим клиентом приложения (Prisma + обёртка) |

## Предусловия

- Копия свежего дампа, восстановленная локально (ранбук 010).
- **На копии накатаны все миграции репозитория.** Прод сейчас на
  `20260712090000_tenant_settings`: таблиц `Shift`, `WorkPermit`,
  `CurrentReadiness` там ещё нет, и без `prisma migrate deploy` проверять
  fail-closed будет не на чем.
- Доступ на прод по SSH и `docker compose` в `/opt/pilingtrack`.

---

## Этап 1. Драйв на восстановленной копии (обязателен)

```bash
# 1. Копия из ночного дампа (ранбук 010, шаги 1-3), база pilingtrack_drill.
#    Быстрая замена для репетиции самой процедуры — копия локальной базы:
docker exec pilingtrack-postgres bash -c 'pg_dump -U postgres -d pilingtrack_test -Fc -f /tmp/roledrill.dump'
docker exec pilingtrack-postgres psql -U postgres -q -c 'DROP DATABASE IF EXISTS pilingtrack_roledrill;' -c 'CREATE DATABASE pilingtrack_roledrill;'
docker exec pilingtrack-postgres bash -c 'pg_restore -U postgres -d pilingtrack_roledrill /tmp/roledrill.dump'
```

```bash
# 2. Роль и гранты. ВАЖНО: той же ролью, что накатывает миграции.
#    Скрипт сам падает, если запущен не владельцем таблиц.
docker exec -i -e PGCLIENTENCODING=UTF8 pilingtrack-postgres \
  psql -v ON_ERROR_STOP=1 -U postgres -d pilingtrack_roledrill < scripts/app-role-grants.sql
```

```bash
# 3. Пароль (только для драйва)
docker exec pilingtrack-postgres psql -U postgres -d pilingtrack_roledrill \
  -c "ALTER ROLE pilingtrack_app WITH PASSWORD 'drill_only_pw_2026';"
```

```bash
# 4. Права и изоляция глазами администратора
docker exec -i -e PGCLIENTENCODING=UTF8 pilingtrack-postgres \
  psql -v ON_ERROR_STOP=1 -U postgres -d pilingtrack_roledrill < scripts/app-role-verify.sql
```

```bash
# 5. То же самое настоящим клиентом приложения
DATABASE_PROVIDER=postgres \
DATABASE_URL='postgresql://pilingtrack_app:drill_only_pw_2026@localhost:5435/pilingtrack_roledrill?schema=public' \
npx tsx scripts/app-role-smoke.ts
```

```bash
# 6. Убрать за собой
docker exec pilingtrack-postgres psql -U postgres -q -c 'DROP DATABASE pilingtrack_roledrill;'
```

**Критерии прохождения драйва:**

- `app-role-verify.sql`: проверка 1 — `pilingtrack_app` с `rolsuper=f`,
  `rolbypassrls=f`; проверка 2 — пусто; проверка 3 — две строки с
  `pilingtrack_app`; проверка 4 — `f`; проверка 5 — нули без тенанта и на
  чужом тенанте, ненулевые значения на своём.
- `app-role-smoke.ts`: восемь `✅` и «Роль пригодна для переключения».

Если хоть одна проверка красная — на прод не идём.

---

## Этап 2. Прод: завести роль и выдать гранты

Этот этап **ничего не переключает** и безопасен сам по себе: роль создаётся без
пароля, войти ею до этапа 3 невозможно.

**Не делать `git pull` ради этих скриптов.** Прод стоит на своём коммите, а в
`main` может лежать сотня незадеплоенных коммитов: `pull` притащит их все и
превратит следующий чей-нибудь `build` в незапланированный релиз. Скрипты
подаются на вход psql прямо с рабочей машины:

```bash
# с локальной машины, из корня репозитория
ssh -i ~/.ssh/orionpiling user1@87.242.102.125 \
  'cd /opt/pilingtrack && docker compose exec -T -e PGCLIENTENCODING=UTF8 postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack' \
  < scripts/app-role-grants.sql

ssh -i ~/.ssh/orionpiling user1@87.242.102.125 \
  'cd /opt/pilingtrack && docker compose exec -T -e PGCLIENTENCODING=UTF8 postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack' \
  < scripts/app-role-verify.sql
```

⚠️ **`docker compose exec -T` читает stdin.** Если завернуть такие команды в
скрипт и скормить его как `ssh 'bash -s' <<EOF`, psql проглотит остаток
скрипта, и половина шагов молча не выполнится — с нулевым кодом возврата.
Ловилось вживую 13.08.2026 на этапе 3. Правило: удалённый скрипт класть
файлом и запускать `bash /tmp/скрипт.sh < /dev/null`.

Ожидаем те же критерии, что в драйве. Приложение в этот момент работает как
работало — оно всё ещё ходит под `piling`.

## Этап 3. Прод: переключение

```bash
# Пароль. Именно hex: он попадает в URL внутри docker-compose,
# а base64 даёт +/= и ломает разбор строки подключения.
APP_PW=$(openssl rand -hex 24)
docker compose exec -T postgres psql -U piling -d pilingtrack \
  -c "ALTER ROLE pilingtrack_app WITH PASSWORD '$APP_PW';"

# В .env (рядом с POSTGRES_USER/POSTGRES_PASSWORD)
printf 'APP_DB_USER=pilingtrack_app\nAPP_DB_PASSWORD=%s\n' "$APP_PW" >> .env
grep -c '^APP_DB_' .env      # ожидаем 2
```

Перед переключением — проверить, что роль вообще пускают с новым паролем.
Дешевле поймать опечатку здесь, чем на упавшем приложении:

```bash
PW=$(grep '^APP_DB_PASSWORD=' .env | cut -d= -f2-)
docker compose exec -T -e PGPASSWORD="$PW" postgres \
  psql -h localhost -U pilingtrack_app -d pilingtrack \
  -c 'SELECT current_user, (SELECT count(*) FROM "Report") AS reports;' < /dev/null
```

```bash
# Переключение. Пересборка НЕ нужна — меняется только окружение.
# Одной командой: разъезд ролей между пулом и приложением означал бы отказ
# аутентификации.
docker compose up -d pgbouncer app workers ws
```

⚠️ **Окно недоступности — около 5 минут, а не секунды.** У `app`, `workers` и
`ws` стоит `depends_on: migrate: service_completed_successfully`, поэтому
`up -d` поднимает и `migrate`: старые контейнеры уже сняты, а новые ждут, пока
`prisma migrate deploy` отработает и выйдет. На проде 13.08.2026 это заняло
~5 минут при «No pending migrations to apply» — то есть время уходит на запуск
контейнера миграций, не на саму работу. Планировать как полноценное окно и
предупреждать смену.

Заодно убедиться, что `migrate` не сделал лишнего:

```bash
docker compose logs --tail 20 migrate    # ожидаем "No pending migrations" и "Skipping seed"
```

## Этап 4. Проверка после переключения

```bash
# 1. Роли: у pilingtrack_app обе колонки должны быть f
docker compose exec -T postgres psql -U piling -d pilingtrack \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('piling','pilingtrack_app');"
```

```bash
# 2. Кем РЕАЛЬНО заняты живые соединения. Это и есть доказательство
#    переключения: env можно поправить и промахнуться, pg_stat_activity — нет.
docker compose exec -T postgres psql -U piling -d pilingtrack \
  -c "SELECT usename, count(*) FROM pg_stat_activity WHERE datname='pilingtrack' GROUP BY 1 ORDER BY 2 DESC;"
```

Ожидаем `pilingtrack_app` у рантайм-соединений. `piling` остаётся только у
разовых сессий (psql, миграции).

```bash
# 3. Полная проверка прав и изоляции
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack < scripts/app-role-verify.sql

# 4. Приложение живо
curl -fsS https://orionpiling.ru/api/health | head -c 400
docker compose logs --since 5m app workers ws | grep -iE "permission denied|42501" || echo "нет отказов в правах"
```

**5. Руками в интерфейсе** — то, что скриптами не проверяется: открыть
техготовность, увидеть непустые списки смен и наряд-допусков, создать и закрыть
смену. Пустой список там, где данные есть, — главный симптом того, что GUC не
ставится: RLS на шести таблицах теперь fail-closed и молча отдаёт ноль строк,
а не ошибку. Обёртка `withReadinessTenantTransaction` GUC ставит и проверяет,
но на новой роли её надо увидеть в работе.

**Шесть таблиц под fail-closed:** `Shift`, `ShiftHandover`, `WorkPermit`,
`WorkPermitApproval`, `ReadinessScoreSnapshot`, `CurrentReadiness`.

## Откат

Полный, за одну минуту, без потери данных:

```bash
cd /opt/pilingtrack
sed -i '/^APP_DB_USER=/d;/^APP_DB_PASSWORD=/d' .env
docker compose up -d pgbouncer app workers ws
```

Без `APP_DB_*` compose подставляет `POSTGRES_USER` — конфигурация возвращается к
прежней. Роль и гранты в базе можно оставить: сами по себе они ничего не меняют.

## Что помнить дальше

- **Новая таблица в миграции получает права автоматически** —
  `ALTER DEFAULT PRIVILEGES` в `app-role-grants.sql` привязан к роли-владельцу.
  Но это работает, только пока миграции накатывает та же роль. После деплоя с
  новыми таблицами прогнать проверку 2 из `app-role-verify.sql`: она покажет
  таблицы без прав.
- **Новая таблица не получает RLS автоматически.** Политику писать руками, по
  ADR-0044: сначала доказать по коду, что путь запроса ставит GUC, потом
  закрывать.
- **psql руками — по-прежнему под `piling`.** Для шести fail-closed таблиц в
  начале сессии: `SET app.current_tenant = 'orion';` (ранбук 003).
- **Владелец через пул больше не подключается** — `auth_user` у pgbouncer стал
  `pilingtrack_app`, и `auth_query` к `pg_shadow` от непривилегированной роли
  ничего не возвращает. Это ожидаемо: миграции ходят напрямую в `postgres:5432`.
- **Переключение роли и деплой техготовности независимы.** Прод сейчас на
  `20260712090000`, шести таблиц там ещё нет. Порядок любой: новые таблицы
  попадут под гранты автоматически.

## Журнал

| Дата | Что | Результат |
|---|---|---|
| 2026-08-13 | Драйв на копии локальной базы (66 таблиц, `20260813030000` накатана) | ✅ `app-role-verify.sql`: права на 65/66 таблиц, DDL запрещён, изоляция 0 / (9 CurrentReadiness, 14 Shift, 15 WorkPermit) / 0. `app-role-smoke.ts`: 8/8. Отдельно проверено через PgBouncer: `current_user=pilingtrack_app`, `Shift`=0 без GUC и 14 в транзакции с GUC — транзакционный пулинг изоляцию не ломает. |
| **2026-08-13** | **Прод переключён** (коммит прода `e948467`, 56 таблиц, миграция `20260712090000`) | ✅ Гранты: 55/56 таблиц. `pilingtrack_app` super=f, bypassrls=f. Живые соединения после переключения: `pilingtrack_app` — 4, `piling` — 2 (psql + экспортёр метрик). Изоляция под ролью: `Equipment` 8 / 8 / 0 (без тенанта / свой / чужой); шести таблиц техготовности на проде ещё нет — скрипт печатает «нет таблицы». Запись под ролью проверена откатанной транзакцией на `Report`. `/api/health` — ok, отказов в правах в логах за 10 минут — 0, сайт 200. Окно недоступности ~5 минут из-за зависимости от `migrate`. |
| — | Файлы в git | не закоммичены; на проде `docker-compose.yml` изменён поверх коммита `e948467`, бэкапы `.env.bak-*` и `docker-compose.yml.bak-*` рядом |
