# AU238-S2-REPORT-REVIEW-ROLES — Проверка отчётов: кто проверяет и как

Версия кода: `git rev-parse HEAD` → `97c5ca434362c6fddff0a9cee7fbf5ba70ad2ee8` (ветка `hermes/q4-0926`).
Аудит только на чтение: код приложения не менялся, создан один файл — этот отчёт.

## Итог

- **Проверки отчёта как целого в продукте нет вообще.** Жизненный цикл `Report` — только `draft → submitted`
  (`src/modules/reports/domain/report.aggregate.ts:43`, `:254-282`); ни статуса «проверен/утверждён/отклонён», ни
  маршрута, ни экрана, ни права. Критичных находок нет, важных — 10, мелочей — 6.
- **Владельцу при этом сообщают, что отчёт «передан на проверку»** — так подписан след сдачи в ленте аудита
  (`src/services/audit/audit-service.ts:441`). Проверяющего у этого события нет: продукт обещает шаг, которого не существует.
- **Фактическая «проверка мастером» — только решение по каждой свае** (принять / на добивку):
  `src/app/api/pile-passports/[id]/decide/route.ts:29`, право `piles.manage`.
- **Запрета проверять «своё» нет нигде**: ни на решении по свае, ни на правке отчёта. Один человек (ADMIN/DISPATCHER)
  может переписать отчёт через `admin-upsert` (окно 24 ч отключено, `src/app/api/reports/admin-upsert/route.ts:64`)
  и тут же сам принять сваи этого отчёта.
- **Оператор не видит решения по своей свае**: журнал закрыт правом `piles.manage`, а мобильный контур
  `acceptance` не читает вовсе — «на добивку» с обязательным основанием до исполнителя не доходит.

## Методика

Что и как искалось (повторяемо):

1. `git rev-parse HEAD` — зафиксирована версия.
2. Обзор: `find src/app/api/reports src/app/api/pile-passports src/modules/reports -type f | sort`.
3. Поиск прав (ripgrep через `search_files`): шаблон `'(reports|piles)\.[a-z_]+'` — 61 совпадение; матрица ролей —
   `src/services/auth/authorization-service.ts:62-135`.
4. Поиск жизненного цикла отчёта: `ReportStatus`, `'submitted'`, `утвержд|проверить отчёт|проверяющий` — по всему `src`;
   `prisma/schema.prisma` (`model Report` `:1927`, `model PilePassport` `:2236`).
5. Поиск признака «записал мастер»: `recordedByForeman` по репозиторию (`search_files`, все типы).
6. Чтение целиком (не фрагментами): `authorization-service.ts`, `resource-access-service.ts`, `report.aggregate.ts`,
   `report-command.service.ts`, `report.repository.ts`, `reconcile-report-entries.ts`, `report-query.service.ts`,
   `pile-passport.service.ts`, `pile-journal-list.ts`, `report-history-service.ts`, `audit-service.ts`,
   `admin-reports.tsx`, `report-form-dialog.tsx`, маршруты `src/app/api/reports/**`, `src/app/api/pile-passports/**`,
   `src/app/api/notifications/telegram/test/route.ts`, `src/app/api/operator/mobile/command/route.ts`,
   `src/modules/operator-mobile/application/commands/production.ts`.
7. Прогон тестов (реальные числа, exit code 0):
   - `node node_modules/vitest/vitest.mjs run src/app/api/reports src/app/api/pile-passports src/services/reports/__tests__/report-history-service.test.ts src/modules/reports/application/queries/__tests__/pile-passport.service.test.ts`
     → **Test Files 15 passed (15), Tests 123 passed (123)**, EXIT=0.
   - `node node_modules/vitest/vitest.mjs run src/services/auth/__tests__/authorization-service.test.ts src/lib/__tests__/page-ability-layouts.test.ts`
     → **Test Files 2 passed (2), Tests 59 passed (59)**, EXIT=0.

Замечание по инструментам: вывод shell-`rg` на этом хосте искажает часть токенов (`status`, `reports.manage`,
`acceptedById` отображались как `n`/`ln`), поэтому все ссылки `файл:строка` в отчёте взяты из `read_file`/`search_files`,
а не из `rg` через терминал.

## Матрица действий: кто может (право → роли)

Роли по матрице `src/services/auth/authorization-service.ts:62-135`. Для оценки «проверка своего» смотрел, есть ли
в пути кода или в UI запрет на действие над собственной записью.

| Действие | Файл:строка | Роль | Проверка своего отчёта | Тест |
| --- | --- | --- | --- | --- |
| Список отчётов всех (ревизия) | `src/app/api/reports/all/route.ts:19` | `reports.read_all` → ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (`:64`) | своего тоже показывает; самоограничения нет | `src/app/api/reports/all/__tests__/route.test.ts:42` (403 OPERATOR, реальный `assertCan`) |
| История правок отчёта | `src/app/api/reports/[id]/history/route.ts:13` + `src/services/reports/report-history-service.ts:47` | те же 4 роли; OPERATOR → 403 | оператор не видит историю **своего** отчёта | `src/app/api/reports/[id]/history/__tests__/route.test.ts:24`; `src/services/reports/__tests__/report-history-service.test.ts:121,138` |
| Чтение редактируемого отчёта | `src/app/api/reports/edit/route.ts:12-25` | права нет — только `requireAuth`; чужой человек → `reports.read_cross_user` (`src/modules/reports/application/queries/report-query.service.ts:38,51`) | свой — любому | `src/app/api/reports/edit/__tests__/route.test.ts` (кейса прав/чужого пользователя нет) |
| Правка своего отчёта | `src/app/api/reports/upsert/route.ts:59` | свой — любому; за другого — `reports.manage_all` | да, и это норма | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts` |
| Правка чужого отчёта (админ-форма) | `src/app/api/reports/admin-upsert/route.ts:23`, окно снято — `:64` | `reports.manage_all` → ADMIN, DISPATCHER | да; ограничения «свой/чужой» и окна 24 ч нет | **нет ни одного теста** (каталога `__tests__` у маршрута нет) |
| Удаление отчёта | `src/app/api/reports/delete/route.ts:47` | `reports.manage_all` → ADMIN, DISPATCHER | да | `src/app/api/reports/delete/__tests__/route.test.ts:104,113` |
| Выгрузка отчётов CSV/XLSX | `src/app/api/reports/export/route.ts:24` | `reports.export` → **только ADMIN** (`:66`) | — | `src/app/api/reports/export/__tests__/route.test.ts` |
| PDF отчётов за период | `src/app/api/reports/pdf/route.ts:80` | `reports.read_all` | — | `src/app/api/reports/pdf/__tests__/route.test.ts` |
| PDF одного отчёта | `src/app/api/reports/single-pdf/route.ts:92,94` | `ensureTenantAccess` + `reports.read_cross_user` | владелец — да; чужой — 4 роли | `src/app/api/reports/single-pdf/__tests__/route.test.ts:94,138` |
| Журнал забивки (просмотр) | `src/app/api/pile-passports/route.ts:34` | `piles.manage` → ADMIN, DISPATCHER, FOREMAN (`:71`) | запрета «своей сваи» нет | `src/app/api/pile-passports/__tests__/route.test.ts:128` (403 для OPERATOR/ASSISTANT/MECHANIC) |
| **Решение по свае (принять / на добивку)** | `src/app/api/pile-passports/[id]/decide/route.ts:29` | `piles.manage` | **запрета проверять свою запись нет** | `src/app/api/pile-passports/[id]/decide/__tests__/route.test.ts` — право не покрыто (см. находку 8) |
| Выгрузка журнала забивки (.xlsx) | `src/app/api/pile-passports/export/route.ts:62` | `piles.manage` | — | `src/app/api/pile-passports/export/__tests__/route.test.ts` |
| Сдача отчёта (draft → submitted) | `src/modules/reports/domain/report.aggregate.ts:254-282` | любой на свой отчёт | да | `src/modules/reports/domain/__tests__/report-aggregate.test.ts` |
| Утвердить / отклонить отчёт | — | **не существует** | — | — |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Что сделать |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/modules/reports/domain/report.aggregate.ts:43,254-282`; `src/app/api/reports/**` | У отчёта нет проверки и утверждения: единственный переход — `draft → submitted`, который делает сам автор. Статусов «проверен/утверждён/отклонён» нет ни в домене, ни в схеме (`prisma/schema.prisma:1939`) | Владелец считает, что сменный отчёт кто-то проверяет; фактически проверять целый отчёт нечем — ни экрана, ни маршрута, ни права. Проверяется только каждая свая отдельно | Либо признать «проверки отчётов нет» и убрать формулировки о проверке из ленты, либо ввести статус проверки и право `reports.verify` |
| 2 | важно | `src/services/audit/audit-service.ts:441` | След сдачи подписан «Отчёт передан на проверку», а проверяющего у события нет (актор — автор, `actorId` есть только у автосдачи) | Продукт обещает шаг процесса, которого не существует: владелец ищет в системе, кто проверяет отчёты, и не находит | Переформулировать («Отчёт сдан») либо реализовать проверку (см. #1) |
| 3 | важно | `src/app/api/reports/admin-upsert/route.ts:23,64` + `src/app/api/pile-passports/[id]/decide/route.ts:29` | Один и тот же человек может переписать отчёт (ADMIN/DISPATCHER, окно 24 ч отключено) и затем сам принять его сваи (ADMIN в режиме «Действую как мастер», `src/services/auth/authorization-service.ts:71,158-160`) | Нет разделения обязанностей: правящий и проверяющий — одно лицо. Для продукта, где «принимает сваю мастер, он же отвечает за участок» (`src/components/piling/pile-journal/index.tsx:28-31`), это подмена независимой приёмки | Запрашивать причину правки сменного отчёта админом и/или запрещать админу, правившему отчёт, решать по его сваям (по `lastEditedById`) |
| 4 | важно | `src/modules/reports/application/queries/pile-passport.service.ts:65-73`; `src/app/api/pile-passports/[id]/decide/route.ts:47-91` | Решение по свае перезаписывается молча: `updateMany` затирает `acceptance/acceptedById/acceptedAt/acceptanceNote` без версии и без ограничения по времени. Прежнее решение остаётся только в `metadata.before` следа аудита | Мастер принял сваю, потом отправил на добивку — в самой свае и в журнале видно лишь последнее решение. Разбор «кто и почему передумал» возможен только по ленте аудита | Либо журнал решений отдельной таблицей, либо запрет менять решение без причины (причина уже обязательна только для добивки, `:60-62`) |
| 5 | важно | `src/app/api/pile-passports/route.ts:34`; `src/modules/operator-mobile/application/mobile-shift-query.ts` (чтения `acceptance` нет) | Оператор не видит решения по своей свае. Просмотр журнала закрыт правом `piles.manage` (`:71`), а мобильный/настольный контур машиниста поле `acceptance` не читает вовсе | «На добивку» с обязательным основанием (`decide/route.ts:16-20`) адресовано машинисту, но он его не увидит ни на телефоне, ни на экране — указание не доходит до исполнителя | Показать машинисту решение и основание по его сваям (в истории смены или в карточке сваи) |
| 6 | важно | `prisma/schema.prisma:2299`; `src/modules/operator-mobile/application/commands/production.ts:369` | `recordedByForeman` не выставляется нигде: `create` задаёт только `recordedById: input.operatorId`, поле остаётся `false` по умолчанию. Поиск `recordedByForeman` по репозиторию даёт лишь чтение (`src/modules/reports/application/queries/pile-journal-list.ts:151`), тип (`pile-journal-types.ts:79`) и фикстуры тестов | Бейдж «Записал мастер» (`src/components/piling/pile-journal/pile-detail.tsx:40-44`) не покажется никогда, а заявленный схемой сценарий «мастер заводит паспорт за машиниста» недостижим: команду принимает только `user.role === 'OPERATOR'` (`src/app/api/operator/mobile/command/route.ts:192`) | Либо реализовать путь мастера (и ставить признак), либо убрать поле и бейдж как недостижимые |
| 7 | важно | `src/app/api/notifications/telegram/test/route.ts:29` | Тестовое сообщение в канал защищено `reports.read_all` (→ ADMIN, DISPATCHER, **FOREMAN, SAFETY_ENGINEER**) вместо `telegram.manage` (только ADMIN, `authorization-service.ts:130`) | Мастер и инженер ОТ могут отправлять тестовые сообщения в рабочий канал оповещений — право выдано по чужому предмету | Заменить на `telegram.manage` |
| 8 | важно | `src/app/api/pile-passports/[id]/decide/__tests__/route.test.ts:14-31` | Тест маршрута решения по свае мокает `assertCan` и **не проверяет его аргумент**: покрыты снимок «before», след аудита и обязательность основания, но не право `piles.manage` | Снятие или подмена права в `decide/route.ts:29` тестами не ловится. Рядом журнал читается правильно: `src/app/api/pile-passports/__tests__/route.test.ts:128` проверяет роли | Добавить `it.each(['OPERATOR','ASSISTANT','MECHANIC'])` → 403 и `expect(assertCan).toHaveBeenCalledWith(..., 'piles.manage')` |
| 9 | важно | `src/app/api/reports/admin-upsert/route.ts` (каталога `__tests__` нет) | Единственный путь правки чужого отчёта без окна 24 ч не покрыт тестами, хотя именно он снимает ограничение `enforceEditWindow` (`:64`). Рядом без тестов и `src/app/api/reports/upsert/route.ts` (операторская запись отчёта), и `src/app/api/reports/recent/route.ts` | Регрессия «окно снято не там» или потеря `assertCan` пройдёт мимо прогона; тесты есть у 9 из 12 маршрутов отчётов (`all`, `delete`, `edit`, `export`, `[id]/history`, `my`, `pdf`, `period`, `single-pdf`) | Добавить тест: 403 без `reports.manage_all`, `enforceEditWindow: false`, работа с `validated.data` |
| 10 | мелочь | `src/services/auth/resource-access-service.ts:70-82`; `src/services/reports/report-history-service.ts:47`; `src/app/api/reports/single-pdf/route.ts:92` | `ensureTenantAccess` требует строгого равенства организации **для всех ролей**: отчёт с `tenantId = NULL` даёт 404 и платформенному администратору. Тест это закрепляет как задуманное (`src/services/reports/__tests__/report-history-service.test.ts:138-143`) | Расхождение с моделью доверия из AGENTS.md (ADMIN/DISPATCHER видят все организации). Сейчас вреда нет: строк с пустой организацией в базе нет — миграция `prisma/migrations/20260817230000_rls_drop_null_tenant_escape/migration.sql:13-15` фиксирует «0 из 0» на снимке прода | Оставить, но зафиксировать в доке: «отчёт без организации читают только… никто»; либо явно разрешить ADMIN дочитывать такие строки |
| 11 | мелочь | `src/app/api/reports/all/__tests__/route.test.ts:5` | Комментарий теста утверждает «requires `reports.read_all` → ADMIN/DISPATCHER only», а матрица даёт это право ещё FOREMAN и SAFETY_ENGINEER (`authorization-service.ts:64`) | Читающий тест получает неверную картину доступа и может «починить» матрицу под комментарий | Править комментарий |
| 12 | мелочь | `src/components/piling/pile-journal/index.tsx:28-31` | Комментарий экрана: «Принимает её мастер… Диспетчер ведёт смены и разбирает дефекты техники — про сваи он не постановляет», а матрица даёт `piles.manage` диспетчеру (`authorization-service.ts:71`, там же обосновано: чтобы разбор не вставал) | Два противоположных утверждения об одном праве в одном продукте | Согласовать текст экрана с матрицей |
| 13 | мелочь | `src/app/api/reports/[id]/history/route.ts:13` | `reports.read_all` проверяется **до** проверки владельца, поэтому OPERATOR получает 403 на историю своего же отчёта (тест это фиксирует: `history/__tests__/route.test.ts:24`) | Оператор не узнает, кто и что поправил в его отчёте, хотя сервис умеет сужать по владельцу (`report-history-service.ts:47`) | Разрешить владельцу читать историю своего отчёта |
| 14 | мелочь | `src/app/api/reports/export/route.ts:24` против `src/app/api/pile-passports/export/route.ts:62` | Выгрузка отчётов — только ADMIN (`reports.export`, `authorization-service.ts:66`), выгрузка журнала забивки — ADMIN, DISPATCHER, FOREMAN | Мастер читает отчёты и решает по сваям, но выгрузить сменные отчёты для подшивки не может, а журнал — может; асимметрия не объяснена | Решить осознанно и записать решение рядом с правом |
| 15 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:207-216` против `src/modules/reports/application/commands/report-command.service.ts:210-218` | Форма разбирает 409 «изменён другим пользователем» и CSRF-403, но не различает 403 «Окно редактирования истекло… правка — через администратора» | Для админского маршрута окно отключено (`admin-upsert/route.ts:64`), поэтому сообщение принадлежит операторской форме; в админской ветке код обработки мёртв | Убрать мёртвую ветку либо покрыть операторскую форму (она в замороженной зоне) |
| 16 | мелочь | `src/modules/reports/infrastructure/reconcile-report-entries.ts:40-46` | Свая с паспортом защищена от удаления/правки через отчёт (это хорошо), но обратной связи нет: правка отчёта не меняет и не сбрасывает решение мастера по свае и не видна в журнале забивки | Две витрины одной работы (отчёт смены и журнал забивки) живут независимо: админ правит «сваи» в отчёте, журнал показывает прежнее | Показать в карточке сваи, что её отчёт правили после решения |

Приложение (все остальные проверки, `path:line`): отчёт целиком — `prisma/schema.prisma:1927-1987`,
`src/lib/report-status.ts:1-6`, `src/lib/types.ts:13`, `src/services/reports/audit-service.ts:11`
(набор действий `created | updated | submitted | deleted` — «проверен» отсутствует).

## Что видно при отклонении

- **Отклонение по свае (`NEEDS_REDRIVE`).** Причина обязательна на границе API
  (`src/app/api/pile-passports/[id]/decide/route.ts:16-20`) и в сервисе
  (`src/modules/reports/application/queries/pile-passport.service.ts:60-62`). Видна: мастеру — в карточке сваи
  (`src/components/piling/pile-journal/pile-detail.tsx:121-125`) и в выгрузке .xlsx
  (`src/modules/reports/application/queries/pile-journal-export.ts:164-167`). Не видна: оператору (находка 5).
  Плюс подсказка «грунту нужен отдых, добивать с …» по сроку `SOIL_REST_DAYS = 3`
  (`src/components/piling/pile-journal/pile-detail.tsx:79-86`, `src/modules/operator-mobile/domain/pile-passport.ts:194`).
- **Отклонение правки отчёта** (русские сообщения, отдаются как `error`):
  403 «Окно редактирования истекло: отчёт сдан N ч назад, правка — через администратора»
  (`src/modules/reports/application/commands/report-command.service.ts:210-218`);
  409 «Отчёт уже сдан и не может быть изменён» (`src/modules/reports/domain/report.aggregate.ts:363-367`);
  409 «Этот отчёт заведён на другую дату или другой объект…» (`report-command.service.ts:169-173`);
  409 «Отчёт был изменён другим пользователем…» (`src/modules/reports/infrastructure/report.repository.ts:118-150`);
  409 «Свая имеет паспорт. Изменяйте её через журнал свай…» и «Нельзя удалить из отчёта сваю с паспортом…»
  (`src/modules/reports/infrastructure/reconcile-report-entries.ts:40-46`).
- **Отказ в отклонении**: `acceptance: 'PENDING'` маршрут не принимает (`decide/route.ts:14`), пустое основание
  для добивки — 400 с текстом «Укажите, почему свая идёт на добивку» (проверено тестом
  `decide/__tests__/route.test.ts:142-150`).

## Не проверено

- **Тесты читались, но не запускались целиком**: прогон ограничен 17 файлами (123 + 59 тестов, exit 0). Полный
  `npm run test:unit`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npx playwright test --list` не выполнялись —
  задача read-only и не требовала прогона гейтов. Колонка «Тест» в таблицах описывает, что покрыто по коду тестов,
  а не результат полного прогона.
- **Не проверялась живая база**: существуют ли в проде отчёты с `tenantId = NULL` (находка 10), я взял из комментария
  миграции `prisma/migrations/20260817230000_rls_drop_null_tenant_escape/migration.sql:13-15` («0 из 0»), сам запрос к базе
  не выполнял. Если такие строки появятся, история и PDF по ним станут недоступны всем — это ГИПОТЕЗА, а не наблюдение.
- **UI не открывался в браузере**: кнопки «Принять сваю» / «На добивку» и их доступность оценены по коду
  (`src/components/piling/pile-journal/pile-detail.tsx:136-143`), фактический рендер и поведение при 403 не проверялись.
- **Замороженные зоны** (`src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, `src/app/operator/**`,
  ORION) читались только как источник правды о путях машиниста; их внутренние правила приёмки/отклонения я не разбирал
  и предложений по ним не даю.
- **Право `reports.read_cross_user` vs `reports.read_all`** на маршрутах `single-pdf` и `media-auth` разобрано
  поверхностно: проверено только, что аргумент передаётся (`src/app/api/reports/single-pdf/route.ts:220`,
  `src/core/media/media-auth.ts:55,197`), соответствие каждой ветки замыслу — не проверено.
- **Как ведёт себя проверка при нескольких тенантах** («до второго тенанта») не оценивалось: прод однотенантный.
