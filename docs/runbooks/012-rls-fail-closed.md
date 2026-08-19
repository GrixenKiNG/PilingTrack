# Runbook 012 — перевод RLS в fail-closed на бою

**Что делаем.** 37 политик `tenant_isolation_*` переводим из режима аудита
(«не назвал организацию — покажем всё») в строгий («не назвал — не покажем
ничего»). Обоснование и разбор — ADR-0046.

**Порядок критичен и необратим по последствиям.** Сначала роль опознания и
переменная окружения, только потом миграция. Наоборот — вход перестанет
работать мгновенно и для всех: организация лежит в той самой строке
пользователя, которую строгая политика больше не отдаст.

**Предусловия**

- Прод уже ходит в базу ролью `pilingtrack_app` без `BYPASSRLS` (ранбук 011,
  выполнено 13.08.2026). Проверить: `scripts/rls-state.sql`, раздел 4.
- Свежий дамп на месте. Ночной таймер в R2 или ручной `pg_dump` перед началом.
- Код с ADR-0046 уже в `main` и собран (расширение доставки организации,
  обёртки сырого SQL, контекст в планировщиках и приёме телеметрии). Без него
  миграция ломает половину экранов.

---

## Этап 0. Снимок состояния до

```bash
cd /opt/pilingtrack
docker compose exec -T postgres psql -U piling -d pilingtrack < scripts/rls-state.sql | tee /tmp/rls-before.txt
```

Ожидаемо: 37 политик в режиме аудита, 6 строгих, пять таблиц без RLS,
`pilingtrack_app` с `обходит RLS = f`.

```bash
# Свежий дамп именно сейчас, а не «вчерашний ночной».
docker compose exec -T postgres pg_dump -U piling -d pilingtrack -Fc \
  > /opt/pilingtrack/backups/pre-rls-flip-$(date +%F-%H%M).dump
ls -lh /opt/pilingtrack/backups/pre-rls-flip-*.dump
```

---

## Этап 1. Роль опознания (до миграции)

```bash
# Заводит pilingtrack_identity: BYPASSRLS, без LOGIN, права ровно на две
# таблицы и ровно на те колонки, которые нужны опознанию.
# Запускать ролью-владельцем — той же, что накатывает миграции.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack \
  < scripts/identity-role-grants.sql
```

Проверка, что роль есть и урезана:

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname='pilingtrack_identity';"
```

Ждём: `f | t | f` — не суперпользователь, обходит RLS, войти ею нельзя.

---

## Этап 2. Переменная окружения (до миграции)

```bash
cd /opt/pilingtrack
grep -q '^DB_IDENTITY_ROLE=' .env || echo 'DB_IDENTITY_ROLE=pilingtrack_identity' >> .env
grep '^DB_IDENTITY_ROLE=' .env
```

Перезапуск приложения и воркеров, чтобы переменная доехала:

```bash
docker compose up -d app workers ws
docker compose ps
```

**Проверка до миграции.** Политики ещё в режиме аудита, но переключение роли
уже работает — вход обязан продолжать работать как раньше:

```bash
curl -si https://orionpiling.ru/api/health | head -3
```

Если вход сломался здесь — снимите `DB_IDENTITY_ROLE` и перезапустите. До
миграции откат стоит одну строку в `.env`.

---

## Этап 3. Миграция

⚠️ В диффе новая папка `prisma/migrations/20260819120000_rls_fail_closed_all`,
значит образ `migrate` надо пересобрать — иначе он скажет «нет ожидающих
миграций» и молча пропустит её (см. ранбук 008, раздел «Миграции»).

```bash
cd /opt/pilingtrack
df -h /                       # >85% — сначала docker builder prune -af
git pull origin main
export APP_VERSION=$(git rev-parse --short HEAD)
docker compose build migrate  # СНАЧАЛА migrate
docker compose build app      # потом по одному — параллельная сборка
docker compose build workers  # забивает 30 ГБ диска в ноль
docker compose up -d migrate
docker compose logs --tail=40 migrate
```

Убедиться, что миграция действительно легла (не верить коду выхода 0):

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack -c \
  "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;"
```

Верхней строкой обязан быть `20260819120000_rls_fail_closed_all`.

```bash
docker compose up -d app workers ws
```

---

## Этап 4. Проверка

```bash
docker compose exec -T postgres psql -U piling -d pilingtrack < scripts/rls-state.sql | tee /tmp/rls-after.txt
diff /tmp/rls-before.txt /tmp/rls-after.txt
```

Ждём: 43 строгих, ноль в режиме аудита, тот же список из пяти таблиц без RLS,
пусто в разделе «RLS без FORCE».

Дальше — руками, в браузере, под живой учётной записью. Порядок такой, потому
что каждый следующий шаг опирается на предыдущий:

1. Вход по паролю. **Это главная проверка.** Не работает — сразу к откату.
2. Вход по ПИН-коду со смартфона (другой путь опознания).
3. Дашборд, отчёты, аналитика по объектам, аналитика по технике.
   Аналитика собирается сырым SQL — если где-то пусто, дело в ней.
4. Техника, ТО, центр готовности, смены, наряды-допуски.
5. Сохранить отчёт. Через минуту убедиться, что цифра в аналитике изменилась —
   это проверяет всю цепочку outbox → проекция.
6. Отправить пробное уведомление в Telegram (Настройки → Интеграции).

**Пустой экран вместо ошибки — это и есть симптом.** Строгая политика не
ругается, она возвращает ноль строк.

Логи на предмет тихих отказов:

```bash
docker compose logs --since=15m app workers | grep -iE "permission denied|row-level|violates row-level" | head
```

---

## Откат

Обратная миграция не нужна и вредна: политики возвращаются одной командой, и
это быстрее, чем ждать сборку.

```bash
# Возврат 37 политик в режим аудита. Строгие шесть таблиц техготовности
# (ADR-0044) не трогаем — они работали так с 13.08.2026.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack -c "
DO \$\$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public' AND qual NOT LIKE '%IS NULL%'
      AND tablename NOT IN ('Shift','ShiftHandover','WorkPermit',
                            'WorkPermitApproval','ReadinessScoreSnapshot','CurrentReadiness')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING ('
      || 'current_setting(''app.current_tenant'', true) IS NULL'
      || ' OR current_setting(''app.current_tenant'', true) = '''''
      || ' OR \"tenantId\" = current_setting(''app.current_tenant'', true))',
      r.policyname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Возвращено в режим аудита: % политик', n;
END \$\$;"
```

**Сразу после отката почистить кэш**, иначе будет казаться, что откат не
помог: Redis держит пустые ответы 5 минут.

```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" FLUSHALL
```

Запись в `_prisma_migrations` при этом остаётся — миграция считается
применённой. Это правильно: код в образе рассчитан на строгие политики и
работает с ними. Чтобы повторить перевод после починки, накатите
`scripts/rls-state.sql` для проверки и заново выполните тело миграции руками:

```bash
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U piling -d pilingtrack \
  < prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql
```

---

## Что изменится в повседневной работе

**psql руками больше ничего не покажет без организации.** Роль `piling` —
владелец, а `FORCE ROW LEVEL SECURITY` распространяется и на владельца:

```sql
SELECT * FROM "Report";           -- 0 строк, и это не потеря данных
SET app.current_tenant = 'orion'; -- назвать организацию в начале сессии
SELECT * FROM "Report";           -- строки на месте
```

Суперпользователь (`postgres`) RLS обходит всегда — если нужен взгляд сразу на
все организации, заходить надо им.

**Одноразовые скрипты из `scripts/` перестанут находить данные,** если ходят
тем же `DATABASE_URL`, что и приложение (то есть ролью `pilingtrack_app`).
Проверено на стенде: скрипт смены ПИН-кода не нашёл пользователя. Запускать их
надо с адресом роли-владельца:

```bash
DATABASE_URL="$DATABASE_URL_POSTGRES" npx tsx scripts/<имя>.ts
```

**Суточный тик техготовности стоит проверить отдельно.** Таблица `Shift` стала
строгой 13.08.2026, в тот же день прод перешёл на роль без `BYPASSRLS`, а
перечень организаций планировщик брал из самой `Shift`. То есть он, вероятно,
уже не работал; ADR-0046 это чинит. После раскатки посмотреть в логах, что тик
проходит:

```bash
docker compose logs --since=24h workers | grep -i "readiness scheduler"
```
