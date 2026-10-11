# AU258-S8-ADMIN-ONBOARDING-CHECKLIST: Чек-лист первого запуска администратора

- Аудит: только чтение, код приложения не изменялся.
- Репозиторий: `D:/PillingR/wt-night-code` (worktree).
- Версия (git rev-parse HEAD при старте): **3b93df92b159bbf53e990ceba3435ae3a1af2512**
- Дата: 11.10.2026. Формат статусов: ПРОЙДЕНО (видел код/текст) / НЕ ПРОВЕРЕНО (нет доступа или не запускал) / ГИПОТЕЗА (вывод по косвенным признакам).

## Итог

1. Автоматического пути создания пользователя в проде **нет**: сид запрещён на `NODE_ENV=production` (`prisma/seed.ts:35-39`), а прод-деплой идёт с `SKIP_SEED=1` (`docs/deployment.md:63`, `docker-compose.prod.yml:144`).
2. Единственный задокументированный путь — ручной SQL-INSERT («Создание первого админа», `docs/deployment.md:113-124`) — **содержит несуществующую колонку `passwordHash`**; реальная колонка — `password` (`prisma/schema.prisma:97`). Команда из документации не выполнится.
3. Строки `Tenant` в чистой прод-БД не создаёт никто: миграции её не вставляют (0 совпадений `INSERT INTO "Tenant"` по `prisma/migrations/`), сид (единственный создатель, `prisma/seed.ts:119-128`) в проде не идёт.
4. В интерфейсе чек-листа первого запуска **нет**: ни один экран не вызывает `/api/system/status` (поиск по `src/components`, `src/app` — 0 потребителей), статусов «Бот не настроен» по Telegram хватает для одной настройки, но общей картины «что ещё не настроено» нет.
5. Прочное есть: 4 health-эндпоинта с разной глубиной (`src/app/api/health/route.ts`, `.../health/deep/route.ts`, `src/app/api/ready/route.ts`, `src/app/api/liveness/route.ts`), административный `/api/system/status` под `users` → `system.read` (`src/app/api/system/status/route.ts:23-31`), ранбук 014 с ручными шагами после выкладки (`docs/runbooks/014-post-deploy-2026-10.md:1-12`).

## Методика (как повторить)

```bash
cd /d/PillingR/wt-night-code
rg -n "firstAdmin|bootstrapAdmin|createFirstAdmin|first-admin" src prisma scripts   # 0 совпадений
rg -n "Tenant" prisma/migrations -l | xargs rg -n 'INSERT INTO "Tenant"'            # 0 совпадений
rg -n "system/status" src/components src/app --glob '!*test*'                        # только api-роуты
rg -n "SKIP_SEED" docker-compose.yml docker-compose.prod.yml docs/deployment.md
rg -n "passwordHash" prisma/schema.prisma prisma/migrations -c                      # 0; реальная колонка: prisma/schema.prisma:97
sed -n '113,124p' docs/deployment.md; sed -n '35,39p' prisma/seed.ts; sed -n '119,153p' prisma/seed.ts
ls scripts/hash-password.ts                                                          # нет файла
rg -n "validate:env" package.json; rg -n "checkEnv|buildReadiness" src/core/observability/health-checks.ts
rg -n "system.read" src/services/auth/authorization-service.ts                       # строки 126, 131
```

Все `файл:строка` ниже — полные пути от корня репозитория, открыты и прочтены в этой сессии.

## Таблица первого запуска (шаг | файл:строка | проверяется | сообщает | риск)

| Шаг | Файл:строка | Что проверяет | Сообщает ли | Риск |
|---|---|---|---|---|
| 1. Секреты/env (SESSION_SECRET и др.) | `docs/deployment.md:29-64`; `scripts/validate-env.ts:28-45` | `npm run dev/build/start` запускает `validate-env.ts` до старта (`package.json:7,8,10`) и есть отдельная цель `validate:env` (`package.json:11`) | Да, текстом в консоли; в runtime — `warn` через `/api/health` (`src/core/observability/health-checks.ts:121-130`) | Средний: `/api/ready` при этом отвечает «ready» (см. Н5) |
| 2. Миграции | `docker-compose.yml:28-38`; `Dockerfile:46` | Контейнер `migrate` гонит `prisma migrate deploy` до `app`/`workers` (`docker-compose.yml:137,214`) | Только код выхода контейнера и `docker logs`; отчёт «какие миграции не легли» в логах/БД — `prisma migrate status` (команда в ранбуках — НЕ ПРОВЕРЕНО) | Высокий: падение миграции = P3009, блокирует все следующие деплои (`scripts/check-migrations.js:23-24`) |
| 3. Сид (dev/CI) | `docker-compose.yml:33-38`; `prisma/seed.ts:709-719` | Создаёт `Tenant`, `TenantSettings`, 6 пользователей, справочники; `console.log('Seed complete')` (`prisma/seed.ts:718`) | Да, в логи контейнера | В проде **отключён** (`docker-compose.prod.yml:144`) — шаг мёртвый для боевого контура |
| 4. Организация (Tenant) | `prisma/seed.ts:119-128` | Только сид делает `tenant.upsert` (`prisma/seed.ts:119`) | Нет, в UI статуса «организация не создана» нет | Критичный в чистой прод-БД: API пользователей без tenantId → 400 «Не задан контекст организации» (`src/app/api/users/route.ts:28,49,98`) |
| 5. Первый админ | `docs/deployment.md:113-124` | Ручной `psql INSERT` + «bcrypt-хэш через `scripts/hash-password.ts`» | Нет | Критичный: INSERT в несуществующую колонку `passwordHash` (Н2), скрипт хэша отсутствует (Н3) |
| 6. Вход | `src/app/page.tsx:13-23`; `src/components/piling/login-page.tsx:29-61` | Сессия по cookie → дашборд роли, иначе `/login`; ошибка «Неверный email или пароль» | Да, тостом ошибки. Состояния «в БД нет ни одного пользователя» отдельного сообщения НЕ существует (ГИПОТЕЗА: ошибка login — один путь, код прочитан полностью) | Средний: владелец не понимает, «нет ли пользователя вообще» |
| 7. Health после старта | `src/app/api/health/route.ts:26-33`; `src/app/api/health/deep/route.ts:30-41`; `Dockerfile:110-111` | status/version/uptime (публичный, узкий deep), Docker HEALTHCHECK 30с×3 | Да, кодом 200/503 + JSON | Низкий |
| 8. Статус «для админа» | `src/app/api/system/status/route.ts:21-42` | `/api/system/status?fresh=true`: DB, Redis, outbox, workers-хартбеаты, storage, uptime; 503 при `unhealthy` | Только API; **экран-потребитель в UI отсутствует** (0 ссылок из `src/components`, `src/app`) | Высокий: богатые диагностики нельзя увидеть из браузера |
| 9. Telegram-бот | `src/components/piling/to/readiness/settings/integrations-section.tsx:77-95` | `telegramCount>0` → «Конфигураций: N», иначе — «Бот не настроен» | Да, в «Настройки» | Низкий; но только одна интеграция показана так |
| 10. Бэкапы после установки | `docs/deployment.md:126-139` | cron `pg_dump` на хосте | Нет, в приложении/БД о бэкапах ничего нет (проверка — только вручную `ls /var/backups`) | Средний: без бэкапов первый день работы — зона риска |

## Находки

| # | Серьёзность | Файл:строка | Суть | Сценарий / почему важно | Предложение | Статус |
|---|---|---|---|---|---|---|
| Н1 | **критично** | `prisma/seed.ts:35-39`; `docker-compose.prod.yml:13-15,144`; `docs/deployment.md:113-115,119-122` | В проде пользователи создаются только ручным SQL-INSERT из документации. Сид запрещён (`NODE_ENV=production` → exit 1), `SKIP_SEED` по умолчанию 1. В `src/` нет ни `firstAdmin`, ни `bootstrapAdmin`, ни маршрута «создать первого админа» — 0 совпадений | Новая БД + деплой = приложение без единого логина. Админ может появиться только командой из п.5 «Создание первого админа», которой нельзя доверять (Н2) | Служебная CLI-команда `npx tsx scripts/create-first-admin.ts <email>`, создающая `Tenant` + `ADMIN` (пароль ≥8, `src/lib/validation-schemas.ts:43`), либо экран «первый вход» при пустой таблице | ПРОЙДЕНО (код) |
| Н2 | **критично** | `docs/deployment.md:117-122`; `prisma/schema.prisma:97`; `prisma/migrations/20260419190903_init/migration.sql:49` | Документированный INSERT в колонку `"passwordHash"` — такой колонки нет: в схеме и миграции `password` TEXT NOT NULL DEFAULT ''. Команда из доков упадёт с `UndefinedColumn` | Единственный задокументированный путь первого админа сломан на шаге ввода; при этом документ предлагает его как рабочий | Исправить колонку на `"password"` и явно указать значение `tenantId`; добавить в документ шаг «создать Tenant», т.к. миграции его не создают (Н1, табл. шаг 4) | ПРОЙДЕНО (код+миграция) |
| Н3 | важно | `docs/deployment.md:124`; `prisma/seed.ts:42-43` | Ссылка на `scripts/hash-password.ts`, которого в репозитории нет (0 совпадений в `scripts/`) | Человек с документом на руках не может сгенерировать хэш штатно и пойдёт на «любой bcrypt-инструмент» (разные costs, соль) | Добавить `scripts/hash-password.ts` (bcrypt cost 12, как в `prisma/seed.ts:42-43`; в доке сейчас указано cost=10 — расхождение) или пометить док «утилита не входит в репозиторий» | ПРОЙДЕНО (поиск) |
| Н4 | важно | `src/app/api/system/status/route.ts:21-42`; `src/components/piling/admin-dashboard.tsx:1-12`; `src/app/(app)/admin/page.tsx:1-8` | `/api/system/status` — единственный «админ-статус» с деталями (ошибки DB, latency Redis, outbox, workers-хартбеаты, storage), защищён `requireAuth + assertCan('system.read')` (`authorization-service.ts:131` — ADMIN/DISPATCHER), но ни один экран не вызывает эту точку (0 ссылок из `src/components`, `src/app` кроме самого роута) | Владелец не увидит «у нас упала БД/Redis/очередь» из браузера — только curl в консоли | Экран «Статус системы» в `/admin` (или отдельный пункт), рендерящий ответ `/api/system/status?fresh=true`, + алерт-подсветка деградаций | ПРОЙДЕНО (поиск 0 потребителей) |
| Н5 | важно | `src/core/observability/health-checks.ts:121-129,192-201`; `src/app/api/ready/route.ts:44-46` | `checkEnv()` возвращает только `pass`/`warn` (никогда `fail`), но `buildReadiness()` проверяет `envCheck.status !== 'fail'` → `/api/ready` при недостающих env отвечает **200/ready**; в `/api/health` `degraded` тоже 200 (`src/app/api/health/route.ts:28-29`) | Gate «приложение готово» зелёный, хотя часть функциональности отключена из-за env; инцидент заметят только по жалобам | Сделать в `checkEnv` статус `fail` для критичных env и вешать readiness на `fail`, либо явно документировать, что readiness — только про DB | ПРОЙДЕНО (код) |
| Н6 | важно | `scripts/validate-env.ts:24-50`; `package.json:7-8,10-11`; `src/core/observability/health-checks.ts:121-129` | Две независимые проверки env с разным набором: при старте — `DATABASE_PROVIDER`, `SESSION_SECRET` (и ещё, дальше в файле), в рантайм-health — только `DATABASE_URL_POSTGRES`, `SESSION_SECRET`. Разные критерии = разные «правды» | Админ видит в рантайм-статусе «env ok», хотя по `validate-env.ts` система «невалидна» (или наоборот) | Единый каталог обязательных env, читаемый и из health, и из CLI-валидатора (один источник истины) | ПРОЙДЕНО (код) |
| Н7 | важно | `prisma/seed.ts:140-152` | Жёстко закодированные пароли («admin123» и т.п.) + их вывод в `console.log` при каждом сиде; хэш-функция `hashPassword` с cost 12 (`prisma/seed.ts:42-43`); единственный guard — `NODE_ENV !== production` (`prisma/seed.ts:35-39`) | «Локалка-похожая-на-прод» с `NODE_ENV=development` получит админа с известным в коде паролем; логи сидда попадают в CI-artefact'ы | Параметры (env/аргументы) + генерация случайного пароля с выводом ОДНОГО РАЗА в stdout без повтора в логах | ПРОЙДЕНО (код) |
| Н8 | важно | `docs/deployment.md:79-82`; `docker-compose.yml:137-139,213-215`; `scripts/check-migrations.js:23-24` | Запущка `migrate deploy` — единственный механизм накатки (контейнер `migrate`, `docker-compose.yml:28-38`); сам `check-migrations.js` фиксирует сценарий «P3009 → блокирует ВСЕ последующие деплои, пока вручную не сделано `prisma migrate resolve --rolled-back`» (`scripts/check-migrations.js:23-24`), но пошаговой процедуры разблокировки/отката в `docs/deployment.md` и `docs/runbooks/008*.md` — **не найдено** (поиск по словам resolve/P3009/откат) | Падающая миграция = «все следующие деплои заблокированы», а процедуры разблокировки в доках нет → простой и риск ручного SQL-вмешательства в схеме | Раздел «P3009 / откат миграции» в ранбук 008: диагностика + `prisma migrate resolve --rolled-back` + сверка `prisma migrate status` | Неполно проверено: читал 008 и deployment.md частично, полный текст обоих — не читал |
| Н9 | мелочь | `src/components/piling/login-page.tsx:29-61,111` | Placeholder email в форме — `operator@piling.ru` (имя сид-оператора, а не админа), ошибка входа — единственный «Неверный email или пароль». Подсказки «в системе ещё нет пользователей» нет | Владелец, открывая «пустой прод», видит обычную ошибку login и не понимает, что причина — отсутствие данных | На 401 при пустой таблице `User` — отдельное сообщение/тост «Система пуста — создайте первого админа по инструкции docs/deployment.md §5» (ГИПОТЕЗА: код прочитан, но «пустая таблица» в рантайме не проверялась) | ГИПОТЕЗА |
| Н10 | мелочь | `src/app/api/ready/route.ts:1-6` vs `src/app/api/readiness/` | `readiness` — «deprecated alias», норм — `ready`. Но в доках (`docs/deployment.md`, ранбуки) встречается написание «readiness», `proxy.ts:120` пропускает оба | Ошибка конфигурации/интеграции: кто-то проксирует `/api/readiness`, а оно позже удалится — или наоборот | Убрать алиас в следующий мажор и поправить ссылки; или явно пометить в доках «не используйте /api/readiness» | ПРОЙДЕНО (код) |
| Н11 | мелочь | `src/app/api/health/route.ts:26-42` vs `docs/deployment.md:68-83` | Health отвечает только `status/version/uptime` (сознательно, см. комментарий «A-3 / July M5», `src/app/api/health/route.ts:3-6`); документ «Первый запуск» про это молчит — нет инструкции «на что смотреть после деплоя» | После выкладки админ не знает, какой код HTTP означает «всё ок» для `/api/health` и `/api/health/deep` | В `docs/deployment.md §3. Первый запуск` добавить блок: `curl /api/health` и `curl /api/health/deep` с расшифровкой JSON-ответа | ГИПОТЕЗА |
| Н12 | мелочь (положительная) | `src/proxy.ts:120`; `src/core/observability/health-checks.ts:164-186`; `src/app/api/system/status/route.ts:21-31` | Четыре health-роута различаются по глубине и по аутентификации; `system/status` — только ADMIN/DISPATCHER; публичный `health` намеренно узкий (без деталей, без hostname'ов) | Хорошо: нет «одного health на все случаи», диагностика изолирована | Не трогать (как есть) | ПРОЙДЕНО (код) |

## Что не проверено

- **Живой запуск**: не запускал `docker compose up`, не входил в приложение, не делал реальных запросов к `/api/health`, `/api/health/deep`, `/api/system/status`, `/api/ready`, `/api/liveness` — вывод «как оно отвечает» — только по коду.
- **Содержимое прод-БД**: есть ли там уже пользователи/организация — не знаю (доступа к прод-БД нет, и не должен быть). Выводы Н1/Н4/Н5/Н9 — по коду и докам.
- **Полный текст** `docs/runbooks/008-manual-deploy.md`, `docs/runbooks/014-post-deploy-2026-10.md`, `docs/deployment.md` — читал фрагменты (1–120 строк 014, 1–180 deployment.md целиком, 008 выборочно). Н8 — на их основе, но полный текст 008 не читан.
- **CI/guard `check-migrations.js`**: файл есть (`scripts/check-migrations.js:1-60`), но где и когда его запускает (CI? pre-push?) — НЕ ПРОВЕРЕНО (`.github` и hooks не читал).
- **`scripts/release-start.bat`** и вся Windows-обвязка развёртывания — не читал; доки описывают только Linux+Docker.
- **UI «админ / пользователи»** (создание нового пользователя через форму) — не проверял вручную; код POST `/api/users` с `users.manage` прочитан (`src/app/api/users/route.ts:46`, `src/lib/validation-schemas.ts:43-52`), но само заполнение формы — не проверял.

## Приложение: другие потребители health/готовности (для полноты)

- `src/instrumentation.ts` — старт health-трекера при запуске Next.
- `src/app/api/metrics/route.ts` (не читал полностью) — Prometheus `/metrics` использует `getCurrentStatus` из health-tracker.
- `src/core/observability/health-tracker/index.ts` — экспорт `getCurrentStatus/getFreshStatus/startHealthTracker` и `recordWorkerHeartbeat` (24-я строка); хартбеаты workers пишутся сюда, `health/deep` показывает их статус.
- `docs/runbooks/001..018` — операционные процедуры по авариям (postgres, redis, outbox, PITR, RLS fail-closed), но «первый запуск / onboarding» среди них **нет** — только 014 «после выкладки».

— конец отчёта —
