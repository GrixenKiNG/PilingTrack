# AU101-VERIFY-STAGE7-8-CITATIONS-R2 — Самопроверка отчётов AUDIT-STAGE7 и AUDIT-STAGE8: ссылки файл:строка

Версия репозитория: `git rev-parse HEAD` = `a44f5eb79ec3794c87773bead940e51fb0f35f43`, ветка `hermes/q4-0926`.
Проверяются два существующих отчёта: `docs/audits/hermes-night/AUDIT-STAGE7-ARCH-RELEASE-OPS.md`
(в нём заявлена версия `998250411a0dc8b0fe81763f144764aa7edbdb03`) и
`docs/audits/hermes-night/AUDIT-STAGE8-SALES-READINESS.md` (заявлена версия `f6309ccbd2db95fb71bf4c5ddae3c27750191733`).
Оба заявленных SHA старше текущего HEAD; ссылки проверялись по текущему рабочему дереву (`a44f5eb7`).
Только чтение: существующие файлы не изменялись, создан один этот отчёт.

Статусы: ПРОЙДЕНО — файл и строка существуют и содержат описанное; ГИПОТЕЗА — не сходится на строке,
но подтверждается рядом; НЕ ПРОВЕРЕНО — проверить не удалось (причина в разделе «Не проверено»).

## Итог

Резюме для владельца (5 строк):

1. Ссылки обоих отчётов в подавляющем большинстве достоверны: из ~110 проверенных ссылок `файл:строка`
   ни одна не указывает на несуществующий файл, и почти все совпадают по содержанию.
2. Найдено 8 несоответствий/неточностей: критичных — 0, важно — 3, мелочь — 5.
3. Главное — в самом отчёте STAGE8 арифметика резюме не сходится с разделами: заявлено «критично 3, важно 7»,
   фактически по разделам «критично 4 (F1,F2,F3,F6), важно 6 (F4,F5,F7,F8,F9,F10), мелочь 5».
4. В отчёте STAGE7 резюме заявляет 16 находок, а строк в реестре 17 (F1–F17): «мелочь» на самом деле 10, а не 9.
5. Прочие расхождения — точечные: одна ссылка на строку в неверном месте (`readiness/export/route.ts:16`)
   и несколько «строка рядом, а не в ней» (`pdf.ts:82-88`, `ci.yml:55`, `Dockerfile:29`, `operator-guide.md:9-11`).

Счёт: критично — 0; важно — 3; мелочь — 5; остальные проверенные позиции — ПРОЙДЕНО (30 строк таблиц).

## Методика

Что и как проверялось (воспроизводимо):

- Открыты оба отчёта целиком: `docs/audits/hermes-night/AUDIT-STAGE7-ARCH-RELEASE-OPS.md`,
  `docs/audits/hermes-night/AUDIT-STAGE8-SALES-READINESS.md` (чтение разрешено заданием).
- Для каждой находки F-реестра обоих отчётов взята её ссылка(и) `файл:строка` и проверена командой печати
  конкретной строки (диапазоны — через `sed -n`):
  `sed -n '<A>,<B>p' <файл>` и `sed -n '<N>p' <файл>`; вывод не обрезался `tail`/`head`.
- Существование файлов проверено через `test -f <путь>` / `ls`; все перечисленные пути в отчётах, кроме
  одного (см. D2), найдены.
- Числовые/греповые утверждения отчётов перепроверены командами:
  - `grep -rn "stop_grace_period" docker-compose*.yml` → пусто (exit 1), как заявлено в STAGE7 F9.
  - `grep -rn "tenant.create\|createTenant" src` (без `generated`) → 0 (STAGE8 F1).
  - `grep -rn "maxUsers\|subscriptionStatus\|monthlyFee\|TenantInvoice\|stripeCustomerId" src` (без `generated`) → 0 (STAGE8 F4).
  - `grep -rniE "deleteTenant|offboard|terminate.*tenant" src` → 0 (STAGE8 F2).
  - `grep -rniE "invite|invitation|приглаш" src` → только слова в комментариях (STAGE8, как заявлено).
  - `find src/app/api/auth -name route.ts` → `login`, `logout`, `me` (STAGE8 F5).
  - `find src/app/api -name route.ts | wc -l` → 141; `ls e2e/*.spec.ts | wc -l` → 11;
    `find src tests -name "*.test.ts" -o -name "*.test.tsx" | wc -l` → 366; `ls docs/runbooks | wc -l` → 19;
    `grep '"version"' package.json` → `2.8.0` (все — протокол STAGE8 §4).
  - `ls -la package-lock.json yarn.lock pnpm-lock.yaml` → только `package-lock.json` (546873 байт) (STAGE7).
  - `grep -rn "console\.log" src --include=*.ts` (без тестов) → 5, все в `src/lib/logger.ts:78` и
    `src/lib/seed/equipment.seed.ts` (STAGE7, подтверждено).
  - Имена метрик в `src/core/observability/lag-monitor.ts` (`outbox_lag_seconds`, `outbox_pending_count`,
    `projection_lag_seconds`, `dlq_pending_count`, `lag_snapshot_timestamp_seconds`) — совпадают (STAGE7).
- Полный набор проверенных позиций сведён в две таблицы ниже: по одной строке на находку (ID), в столбце
  «ссылки» перечислены все её `файл:строка`.

## Находки

Формат: `# | severity | отчёт | ID | ссылки файл:строка | существует | соответствует | комментарий`.
Severity проставлена по худшему вердикту ссылки (для строк ПРОЙДЕНО — «ПРОЙДЕНО»).

### AUDIT-STAGE7-ARCH-RELEASE-OPS.md

| # | severity | ID | ссылки (файл:строка) | сущ. | соотв. | комментарий |
|---|---|---|---|---|---|---|
| 1 | ПРОЙДЕНО | F1 | `.github/workflows/ci.yml:40`; `.github/workflows/integration.yml:44`; `Dockerfile:4`; `Dockerfile.workers:23` | ДА | ДА | `ci.yml:40`=`node-version: '20'`; `integration.yml:44`=`'22'`; оба образа `node:22-alpine`. Совпадает. |
| 2 | ПРОЙДЕНО | F2 | `.github/workflows/deploy.yml:5-8`; `:27-33`; `:67` | ДА | ДА | `:5-6`=`on:/workflow_dispatch:`; блок `deploy` без `needs`; `:67`=`git pull origin main`. Совпадает. |
| 3 | ПРОЙДЕНО | F3 | `.github/workflows/deploy.yml:109-124`; `:115-118` | ДА | ДА | цикл `for i in seq 1 30` вокруг curl; при несовпадении `ACTUAL`/`EXPECTED` — `exit 1` на `:116-117`. Совпадает. |
| 4 | мелочь | F4 | `docker-compose.prod.yml:42-51`; `docker-compose.yml:223-230`; `src/workers/unified-worker/pdf.ts:82-88`; `docker-compose.yml:176` | ДА | частично | 512m/0.75, базовые `memory: 2G`, `PDF_WORKER_CONCURRENCY=2` — верно. Но «комментарий о пиках heap на периодных отчётах» в `pdf.ts` лежит на `:79-80`, а диапазон `:82-88` — это сам `logger.info('PDF job completed', …)`. Строка рядом, а не в указанном диапазоне. |
| 5 | ПРОЙДЕНО | F5 | `docs/runbooks/010-restore-drill.md:146`; `:157-160` | ДА | ДА | `:146`=RTO «≈ 11 с … Для боевой базы — не измерено»; `:157-160`=блок «Почему RTO на бою не измерен». Совпадает. |
| 6 | ПРОЙДЕНО | F6 | `docs/runbooks/010-restore-drill.md:187-190`; `scripts/backup-postgres.sh:47-49` | ДА | ДА | `runbook:189-190`=«Фото и файлы … учением не проверялись»; `backup-postgres.sh:47-49`=`pg_dump -F c | gzip`. Совпадает. |
| 7 | ПРОЙДЕНО | F7 | `scripts/backup-postgres.sh:98-103`; `:68-74` | ДА | ДА | `:98-101`=fallback на `S3_*` (`CRED_SOURCE="S3_* (shared with app media …)"`); `:68-74`=предупреждение об общем ключе. Совпадает. |
| 8 | ПРОЙДЕНО | F8 | `src/lib/logger.ts:28`; `:45-58` | ДА | ДА | `:28`=`[key: string]: unknown;`; `:45-58`=`formatEntry` сериализует `...data` как есть. Совпадает. |
| 9 | ПРОЙДЕНО | F9 | `docker-compose.yml:60-68`; `:155-163`; `src/workers/unified-worker.ts:45-49` | ДА | ДА | у `app` и `workers` нет `stop_grace_period` (grep пуст); `unified-worker.ts:45-49`=комментарий+`SHUTDOWN_TIMEOUT_MS` 8000 мс. Совпадает. |
| 10 | ПРОЙДЕНО | F10 | `docs/deployment.md:126-139`; `:145`; `:157` | ДА | ДА | `:126-139`=cron-бэкап; `:145`=`git fetch && git checkout v2.3.0`; `:157`=`--scale app=3 … App stateless`. Совпадает. |
| 11 | ПРОЙДЕНО | F11 | `src/app/api/health/route.ts:25-29`; `.github/workflows/deploy.yml:110-124` | ДА | ДА | `statusMap` `ok/degraded → 200`, `unhealthy → 503`; деплой смотрит только версию. Совпадает. |
| 12 | ПРОЙДЕНО | F12 | `docker-compose.prod.yml:64-111`; `docs/runbooks/010-restore-drill.md:143-146` | ДА | ДА | `prod.yml:64-111`=один `postgres` без реплик; `runbook:143-146`=RPO ≈24 ч. Совпадает. |
| 13 | ПРОЙДЕНО | F13 | `docker-compose.yml:257-260`; `:365` | ДА | ДА | `:257-259`=комментарий «3 services × Prisma max=20 = 60 … Pool size 40»; `:365`=`max_connections=200`. Совпадает. |
| 14 | мелочь | F14 | `.github/workflows/ci.yml:55`; `AGENTS.md:55` | ДА | частично | `AGENTS.md:55`=«lint baseline is zero warnings» — верно. Но фраза «~684 warnings» в `ci.yml` лежит на `:54`; на `:55` — только «warnings are allowed and don't fail the gate).». Фрагмент рядом, не на указанной строке. |
| 15 | ПРОЙДЕНО | F15 | `observability/prometheus/alerts.yml:320-330`; `scripts/app-guard.sh:1-26` | ДА | ДА | `alerts.yml:320-330`=правило `AlertmanagerDown` с оговоркой про внешний сторож; `app-guard.sh:1-26`=шапка dead-man switch с прямым Telegram. Совпадает. |
| 16 | ПРОЙДЕНО | F16 | `scripts/disk-guard.sh:47-60`; `scripts/app-guard.sh:237-250` | ДА | ДА | `disk-guard.sh:47-60`=отправка через `ALERTMANAGER_WEBHOOK_TOKEN`/app-вебхук; `app-guard.sh:237-250`=проверка `/api/health`. Совпадает. |
| 17 | ПРОЙДЕНО | F17 | `.github/workflows/ci.yml:242-245`; `:356-367` | ДА | ДА | `:242-245`=комментарий «only a curated set … Revisit once those areas stabilise»; `:356-367`=список golden-path спеков. Совпадает. |
| 18 | мелочь | охват | `Dockerfile:15,29` | ДА | частично | `Dockerfile:15`=`RUN npm ci …` — верно; `Dockerfile:29` — комментарий про `APP_VERSION`, а не `npm ci` (второй `npm ci` — в `Dockerfile.workers:29`). |
| 19 | мелочь | охват | `health-tracker/scheduler-registry.ts` | ДА* | частично | Файл существует, но по пути `src/core/observability/health-tracker/scheduler-registry.ts`; в отчёте путь неполный (нет префикса `src/core/observability/`). Импорты из него есть в `src/workers/unified-worker.ts:33` и др. |
| 20 | ПРОЙДЕНО | методика | `.github/workflows/integration.yml:67-70`; `vitest.config.ts:69`; `src/core/outbox/dead-letter-queue.ts:113-151`; `scripts/deploy-prod.sh:93-104,142-143`; `.github/workflows/deploy.yml:60-66`; `docker-compose.yml:42-47,78`; `src/lib/logger.ts:78`; `src/services/auth/auth-service.ts` | ДА | ДА | Все перечисленные строки содержат описанное (синтетическое учение RLS, coverage-порог, `retryDlqEntry` с захватом строки, откатные теги, `APP_DB_USER` на `:78`, `logger.error(… err)` без PII). |
| 21 | важно | Итог | сводка на стр. 61 отчёта: «всего 16 (важно 7, мелочь 9)» | — | НЕТ | В реестре фактически 17 находок F1–F17: важно 7 (F1–F6, F8), мелочь 10 (F7, F9–F17). «9 мелочей» и «16 всего» не сходятся с числом строк реестра. |

### AUDIT-STAGE8-SALES-READINESS.md

| # | severity | ID | ссылки (файл:строка) | сущ. | соотв. | комментарий |
|---|---|---|---|---|---|---|
| 22 | ПРОЙДЕНО | F1 | `prisma/seed.ts:35-40`; `:101`; `:119-128` | ДА | ДА | `:35-40`=`assertNotProduction` c `process.exit(1)`; `:101`=`process.env.DEFAULT_TENANT_ID ?? 'orion'`; `:119-128`=`db.tenant.upsert`. Совпадает. |
| 23 | важно | F2 | `prisma/schema.prisma:114`; `src/app/api/reports/export/route.ts:18`; `src/app/api/readiness/export/route.ts:16`; `src/app/api/pile-passports/export/route.ts:46` | ДА | частично | `schema.prisma:114`=`onDelete: Restrict` — верно; `reports/export:18` и `pile-passports/export:46`=`export const GET = withApi(` — верно. Но `readiness/export/route.ts:16`=`const DATASETS = new Set([...])`, а экспорт-хендлер — на `:177` (`export const GET = withApi(handleGet, …)`). Ссылка указывает не на строку выгрузки. |
| 24 | ПРОЙДЕНО | F3 | `docs/audit.md:139-146`; `src/core/notifications/telegram.ts:49`; `src/core/outbox/dead-letter-queue.ts:95`; `src/app/api/alerts/webhook/route.ts:113,124` | ДА | ДА | `audit.md:139-146`=пункт A-9; `telegram.ts:49`, `dlq.ts:95`, `webhook:113,124` — подстановка `process.env.DEFAULT_TENANT_ID` в фоновых путях. Совпадает. |
| 25 | ПРОЙДЕНО | F4 | `prisma/schema.prisma:19-20`; `:23-30`; `:65-85`; `src/services/users/user-service.ts:145-197` | ДА | ДА | `:19-20`=`maxUsers`/`plan`; `:23-30`=Stripe-поля; `:65-85`=`model TenantInvoice`; `user-service.ts:145-197`=`createUser` без проверки лимита. `grep` по `maxUsers` в `src` → 0. Совпадает. |
| 26 | ПРОЙДЕНО | F5 | `src/app/api/users/route.ts:40-87`; `:80`; `scripts/reset-one-password.ts` | ДА | ДА | `:40`=`export const POST = withMutation(`; `:80`=`role: rest.role || 'OPERATOR'`; скрипт сброса существует. Совпадает. |
| 27 | ПРОЙДЕНО | F6 | `docker-compose.yml:29-40`; `docker-compose.prod.yml:144`; `README.md:33-36`; `setup.bat:116-120`; `setup.sh:116-120`; `prisma/seed.ts:36` | ДА | ДА | `:29-40`=`NODE_ENV=development npx tsx prisma/seed.ts`; `prod.yml:144`=`SKIP_SEED=${SKIP_SEED:-1}`; README/`setup.*` печатают `admin123` и др.; `seed.ts:36` — сама проверка. Совпадает. |
| 28 | ПРОЙДЕНО | F7 | `setup.sh:73-74`; `docker-compose.yml:99,192`; `:41-49`; `:92-98`; `prisma/seed.ts:101` | ДА | ДА | `setup.sh:73-74`=`MULTI_TENANT_MODE=single` / `DEFAULT_TENANT_ID=default`; `compose:99,192`=env `DEFAULT_TENANT_ID` у app/workers; `:41-49`=env контейнера `migrate` без `DEFAULT_TENANT_ID`; `:92-98`=комментарий-пояснение. Совпадает (механику env живой установкой не проверял — GIPOTEZA отчёта сохранена). |
| 29 | ПРОЙДЕНО | F8 | `src/modules/settings/domain/settings.ts:9-17`; `src/app/api/settings/route.ts:23-57` | ДА | ДА | `settings.ts:9-17`=комментарий про `inn/dateFormat/units/currency` «хранятся исторически и не влияют ни на что»; `settings/route.ts:23-57`=PUT. Совпадает. |
| 30 | ПРОЙДЕНО | F9 | `LICENSE:1`; `RELEASE-NOTES.md:108` | ДА | ДА | `LICENSE:1`=`MIT License`; `RELEASE-NOTES.md:108`=`© 2026 PilingTrack. Все права защищены.` Совпадает. |
| 31 | ПРОЙДЕНО | F10 | `src/app/api/dictionary/manage/route.ts:96-133` | ДА | ДА | `:96`=`POST = withMutation`, ручное создание словарей; импорта нет. Совпадает. |
| 32 | мелочь | F11 | `docs/onboarding-orion-app.md:22`; `docs/operator-guide.md:9-11` | ДА | частично | `onboarding-orion-app.md:22`=`Адрес рабочей версии: **orionpiling.ru**` — верно. Но `operator-guide.md:9-11` — обезличенный текст (смартфон, логин/пароль), слова «Орион» в файле нет вовсе (`grep Орион|orion` → 0). Второй источник «написан под Орион» этими строками не подтверждается. |
| 33 | ПРОЙДЕНО | F12 | `src/services/feedback/feedback-event-service.ts` | ДА | ДА | Файл существует; внешнего канала поддержки в `src` нет. Совпадает. |
| 34 | ПРОЙДЕНО | F13 | `AGENTS.md:51`; `prisma/schema.prisma:88-90` | ДА | ДА | `AGENTS.md:51`=«Roles «Мастер» and «Инженер ОТ» — no users by design»; `schema.prisma:88-90`=комментарий о 7 ролях и CHECK `chk_user_role_valid`. Совпадает. |
| 35 | ПРОЙДЕНО | F14 | `src/app/api/settings/route.ts:27`; `src/services/auth/authorization-service.ts:82-83` | ДА | ДА | `:27`=`if (user!.role !== 'ADMIN') … 403`; `authorization-service.ts:82-83`=`users.read` 4 роли, `users.manage` только ADMIN. Совпадает. |
| 36 | ПРОЙДЕНО | F15 | `src/lib/tenant-iteration.ts:22-38` | ДА | ДА | `forEachTenant` — строго последовательный `for … await` по `db.tenant.findMany`. Совпадает. |
| 37 | ПРОЙДЕНО | охват/протокол | `src/services/auth/resource-access-service.ts:75-82`; `docs/deployment.md:5-8`; `src/services/users/user-service.ts:249-289`; `src/services/dictionaries/tenant-dictionary-initializer.ts:15`; `docs/proposals/data-retention.md:3` | ДА | ДА | `resource-access:75-82`=проверка `user.tenantId` и `resourceTenantId !== user.tenantId` без байпаса ADMIN/DISPATCHER (совпадает с выводом отчёта о снятом байпасе); `deployment.md:5-8`=«2 vCPU, 4 GB RAM, 20 GB SSD»; `user-service:249-289`=защита «последнего админа»; остальное совпадает. Числа протокола (141/11/366/19/2.8.0) воспроизведены. |
| 38 | важно | Итог | сводка на стр. 16 отчёта: «критично 3, важно 7, мелочь 5» | — | НЕТ | По разделам реестра: критично — 4 (F1, F2, F3, F6), важно — 6 (F4, F5, F7, F8, F9, F10), мелочь — 5 (F11–F15). Итого 15 — сумма верна, но распределение «3/7/5» не сходится с раскладкой по заголовкам (4/6/5). |

## Не проверено

1. Ссылки на строки проверялись по текущему рабочему дереву (`a44f5eb7`); заявленные в отчётах SHA
   (`9982504…`, `f6309cc…`) я не выкладывал (`git checkout` не делался — правило branch-only, только чтение).
   Если между теми коммитами и текущим строки сдвигались, перечень мог бы отличаться; на текущем HEAD
   все ссылки, кроме отмеченных «частично», совпали.
2. Смысловые выводы находок (риски, последствия) повторно не проверялись — проверялось только соответствие
   ссылки `файл:строка` описанному фрагменту, как требует задание.
3. Не проверял ссылки внутри разделов «Методика/протокол» отчётов вне перечисленных в таблицах
   (например, ссылки на `docs/strategy/**`, `CODEX-REPORT*`, прочие `docs/audits/**`) — закрыты правилом задания.
4. Пункты отчётов, требующие запуска приложения/БД/стенда (RTO/RPO на бою, лимиты памяти под PDF-нагрузкой,
   статус `BACKUP_S3_*` на проде, поведение env Docker Compose в F7 у STAGE8) — не воспроизводимы при
   чтении кода; они и в исходных отчётах помечены «НЕ ПРОВЕРЕНО»/«ГИПОТЕЗА» и здесь не переоценивались.
5. Арифметика счёта находок (стр. F-строки 21 и 38) проверена вручную по нумерации в реестрах; машинной
   сверки «номер ID ↔ заголовок раздела» не делал (отчёты — обычный Markdown без структурных меток).
