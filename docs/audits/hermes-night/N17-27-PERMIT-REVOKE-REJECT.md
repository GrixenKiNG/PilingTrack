# N17-27 — Наряд-допуск: отзыв и отказ (команды, переходы, экран)

Аудит только чтением. HEAD на момент проверки: `b924a388e9198b947af94361f2b7c55ebd195f40`, ветка `hermes/code-1011`. Код не менялся, приложение не запускалось, тесты не прогонялись, БД не трогалась.

## Итог

Проверены две «разрушительные» операции наряда-допуска — **отзыв** (`revoke`, только из `APPROVED`) и **отказ** (`reject`, только из `PENDING_APPROVAL`). Механика прочная: переходы централизованы в `ALLOWED`, обе операции идут через одну `versionedAction`, состояние проверяется и на сервере, право отзыва — `readiness.permit.edit` (по умолчанию ADMIN/MECHANIC/SAFETY_ENGINEER), право отказа — approve-флаг роли (DISPATCHER/ADMIN) плюс правило «автор не отказывает себе»; аудит пишется в той же транзакции и в цепочку (`work-permit.revoke` / `work-permit.reject`), дополнительно заказывается снимок готовности. Найдено **8 находок: 0 критично, 2 важно, 6 мелочь**.

Главное — не логика, а **читаемость следа**:

1. **важно** — отказа в журнале нет как человеческого события: `work-permit.reject` не заведён ни в подписи, ни в значки, ни в список критичных действий → диспетчер видит сырой код `work-permit.reject` с зелёной галочкой «успешно» (запасная ветка `auditActionMark`), и отказ не попадает в плитку «Критических действий» (`audit-labels.ts:39-51,84-92,112-147`).
2. **важно** — обязательная причина отзыва (3–1000 символов) хранится в БД и в аудит-снимке, но её **не показывает ни один экран и ни одна выгрузка**: `revokeReason` не встречается в `src/components/**` (grep — 0), деталь журнала не рендерит before/after, а CSV нарядов и CSV журнала колонку причины не содержат (`audit-section.tsx:169-183`, `export/route.ts:73-78,92-98`).

Остальное — UX-мелочи и пробелы тестов: отказ спрятан за диалогом «Согласовать», валидация причины отзыва в UI и в команде слабее, чем у отказа, у отзыва не растёт `version`, нет теста маршрута отзыва.

## Методика

Прочитано целиком (path:line — по факту открытия):

Маршруты: `src/app/api/readiness/work-permits/[id]/revoke/route.ts` (23), `.../reject/route.ts` (23), `.../close/route.ts`, `src/app/api/readiness/_shared/{route-adapter,request-context,response}.ts`, `src/app/api/readiness/export/route.ts` (177).

Команды и схемы: `src/modules/readiness/application/permits/commands.ts` (329, читаны 1-99, 190-329), `permits/schemas.ts` (81).

Домен: `domain/permits/transitions.ts` (52), `domain/permits/approval-policy.ts` (116), `domain/capability-defaults.ts` (136), `domain/audit/mask.ts` (35), `domain/readiness-rules.ts` (частично 160-189), `application/readiness-score.ts` (частично 185-204).

Инфраструктура: `infrastructure/permits/work-permit-repository.ts` (289, читаны 215-289), `infrastructure/audit/{record-audit,append-audit}.ts` (grep: `revokeReason`/`rejectReason`/`revokedAt` — 0 совпадений).

Экран: `src/components/piling/to/readiness/screens/permits-screen.tsx` (477, читаны 1-22, 140-199, 290-349, 425-477), `settings/audit-labels.ts` (222), `settings/audit-section.tsx` (частично 160-189).

Тесты: `application/permits/commands.test.ts` (40-119), `commands-lifecycle.test.ts` (356-389), `app/api/readiness/work-permits/[id]/reject/route.test.ts` (38), `screens/__tests__/permits-screen.test.tsx` (частично).

Поиски (весь репозиторий, `rg`/glob): `revokeReason` по `src/components` (**0** — причина отзыва нигде не рисуется), `revokeReason|rejectReason|revokedAt` по `infrastructure/audit` (**0** — маска их не трогает), `revokeWorkPermitSchema|rejectWorkPermitSchema|closeWorkPermitSchema` (16 совпадений — использований схемы отзыва в тестах нет), glob `work-permits/**/*.test.ts` (есть `route.test.ts`, `[id]/reject/route.test.ts`, `[id]/close/route.test.ts`; **`[id]/revoke/route.test.ts` отсутствует**).

Замороженные зоны (экраны оператора, ORION) не читались — вне скоупа.

Репро: `rg -n "revokeReason" src/components` (пусто), `rg -n "work-permit.reject" src/components/piling/to/readiness/settings/audit-labels.ts` (пусто).

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/to/readiness/settings/audit-labels.ts:39-51` (нет `work-permit.reject` в `ACTION_LABEL`), `:112-147` (нет в `ACTION_MARK`), `:84-92` (нет в `CRITICAL_ACTIONS`); запасная ветка `:154-159` | Отказ наряда — сырой код + зелёная галочка «успешно». `work-permit.reject` есть в аудите (commands.ts:261-271, eventAction = `input.action`), но подписи/значка нет: `auditActionMark` отдаёт `CheckCircle2, tone: 'success'`, `auditImportanceLabel` — «Обычное» | Диспетчер отказал в согласовании (самое весомое решение в потоке), а в журнале строка `work-permit.reject` с зелёной галочкой «успешно» и важностью «Обычное»; в плитку «Критических действий» отказ не входит. Отзыв в тех же списках есть (`:47,88,135`), а отказ забыт | Добавить `work-permit.reject: 'Наряд отклонён'`/`{icon: Ban, tone: 'danger'}` и внести в `CRITICAL_ACTIONS` |
| 2 | важно | `src/components/piling/to/readiness/screens/permits-screen.tsx:43-45` (есть только `PermitRejection` для отказа), `settings/audit-section.tsx:169-183` (деталь журнала без before/after), `src/app/api/readiness/export/route.ts:73-78,92-98` | Обязательная причина отзыва нигде не отображается: `revokeReason` отсутствует во всём `src/components/**` (grep — 0). Отказ свой `rejectReason` показывает (permit-rejection), отзыв — нет. Деталь журнала рисует только Автора/Роль/Дату/Действие/Объект/хеш; CSV нарядов и CSV журнала колонки причины не содержат | Наряд отозван, причина (3–1000 символов, обязательна по schema `revokeWorkPermitSchema`, schemas.ts:65-68) записана в БД и в аудит-снимок, но её не видит ни диспетчер на экране, ни выгрузка. Значение есть, доступа к нему нет | Показывать причину в карточке отозванного наряда (по образцу `PermitRejection`) и/или рендерить before/after в детали журнала |
| 3 | мелочь | `src/components/piling/to/readiness/screens/permits-screen.tsx:438` (кнопка «Отказать» только в footer диалога согласования), `:303` (таблица: только submit/approve/revoke), `:326` (мобильная карточка: submit/approve/revoke) | Нет прямого действия «Отказать»: отказ достижим только цепочкой «Согласовать» → «Отказать» в подвале диалога. В реестре и в мобильной карточке отдельной кнопки отказа нет | Диспетчер хочет отказать — должен сначала открыть диалог «Согласовать». Не ошибка, но действие спрятано глубже, чем согласование | Добавить кнопку «Отказать» в действия `PENDING_APPROVAL` (или явную пару «Согласовать / Отказать») |
| 4 | мелочь | `src/components/piling/to/readiness/screens/permits-screen.tsx:466` (textarea причины отзыва без `required/minLength/maxLength`), `:439` (кнопка «Подтвердить» блокируется по `!commandText.trim()`), `:158,470` (у отказа `minLength=3`, `maxLength=1000`) | Рассинхрон валидации причины отзыва и отказа: у отказа UI требует ≥3 символов и ограничивает 1000, у отзыва — только «непусто», а лимита нет. Сервер отбивает 1–2 символа и >1000 (schema), но только после запроса | Пользователь вводит 2 символа в причину отзыва, кнопка активна, запрос уходит и возвращается 422 «Некорректные данные отзыва». Лишний круг туда-обратно | Выровнять textarea отзыва с отказом (`required minLength={3} maxLength={1000}` и условие кнопки `<3`) |
| 5 | мелочь | `src/modules/readiness/application/permits/commands.ts:255-257` (revoke — `if (!input.reason)`), в сравнении с `:263-264` (reject — `revokeWorkPermitSchema`/`rejectWorkPermitSchema.safeParse`) и `:326-327` (close — `closeWorkPermitSchema.safeParse`) | Команда `revoke` проверяет причину только на truthy, без `trim` и без `min/max`. `reject` и `close` повторно парсят схему внутри команды (защита в глубину), `revoke` — нет | Прямой вызов команды мимо маршрута (будущий внутренний потребитель, воркер) протолкнёт причину из одних пробелов или длиной 2000. Сейчас маршрут уже провалидировал, поэтому наружу не торчит, но защита несимметрична | Использовать `revokeWorkPermitSchema.safeParse({expectedVersion, reason})` внутри revoke, как в reject/close |
| 6 | мелочь | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:256-263` (revoke: `data` без `version`), в сравнении с `:269` (close: `version: input.version + 1`) и `:280` (reject: `version+1`) | Отзыв не увеличивает `version` наряда. Защита от повторного отзыва держится только на `state: 'APPROVED'` в условии `updateMany` (второй отзыв → count 0 → 409). Гонки нет, но контракт отличается от close/reject | После отзыва ETag наряда не меняется: клиент с `If-Match` видит ту же версию. Условные запросы по версии не отражают факт отзыва | Привести revoke к тому же виду: `version: input.version + 1` (согласованно с close/reject) |
| 7 | мелочь | `src/app/api/readiness/work-permits/[id]/` — нет `revoke/route.test.ts` (glob: есть `route.test.ts`, `[id]/reject/route.test.ts`, `[id]/close/route.test.ts`); `commands.test.ts:75` покрывает `rejectWorkPermitSchema`, а теста `revokeWorkPermitSchema` нет | Маршрут отзыва не покрыт юнит-тестом (в отличие от отказа и закрытия), схема причины отзыва не проверяется тестом вовсе | Регрессия валидации/прокидывания данных отзыва (в т.ч. `trim`, границы 3–1000, отказ чужого tenant) не будет поймана | Добавить `revoke/route.test.ts` по образцу `reject/route.test.ts` |
| 8 | мелочь | `src/modules/readiness/application/permits/commands-lifecycle.test.ts:374` (`it.each(['DRAFT','PENDING_APPROVAL','REVOKED'])`), `:359-389` | Негативные тесты отзыва не покрывают состояния `CLOSED`/`EXPIRED` (в `ALLOWED.revoke` только `APPROVED`, transitions.ts:9) и конфликт версий 409 | Переходы `revoke` из `CLOSED`/`EXPIRED` и отзыв со старой версией не зафиксированы тестом: изменение `ALLOWED` или потеря проверки версии пройдут незамеченными | Дополнить набор состояний (`CLOSED`, `EXPIRED`) и добавить тест 409 для отзыва |

### Таблица действий (обязательная)

| действие | из какого состояния | кто может | что записано | файл:строка | риск |
|---|---|---|---|---|---|
| Отозвать наряд | `APPROVED` | право `readiness.permit.edit` — по умолчанию ADMIN, MECHANIC, SAFETY_ENGINEER (у DISPATCHER права нет) | `state=REVOKED`, `revokedAt=now`, `revokedById`, `revokeReason`; `version` НЕ меняется; аудит `work-permit.revoke` (before+after) в цепочке; outbox `ReadinessSnapshotRequested` | `domain/permits/transitions.ts:9`; `application/permits/commands.ts:219,249-260,305-307`; `domain/capability-defaults.ts:32,64,112,130`; `infrastructure/permits/work-permit-repository.ts:256-263` | причина нигде не видна (#2); версия не растёт (#6); нет теста маршрута (#7), нет тестов CLOSED/EXPIRED/409 (#8) |
| Отказать в согласовании | `PENDING_APPROVAL` | approve-флаг исполняемой роли: DISPATCHER (`readiness.permit.approve_dispatcher`) или ADMIN (`readiness.permit.approve_admin`); автор наряда отказать себе не может; `assertPermitEditor` для reject НЕ вызывается | `state=DRAFT`, `version+1`, `rejectedAt/ById/Reason`, `submittedAt=null`, `approvedAt=null`; подписи этой версии → `valid=false`, `invalidationReason='Отказ: …'`; аудит `work-permit.reject` (before+after); outbox `ReadinessSnapshotRequested` | `domain/permits/transitions.ts:7`; `application/permits/commands.ts:219,261-271` (403 автору — `:265`); `domain/permits/approval-policy.ts:10-13,52-100`; `infrastructure/permits/work-permit-repository.ts:276-289` | в журнале сырой код + зелёная галочка, не «критично» (#1) |

### Контекст, признанный осознанным (не находка)

- Отзыв наряда, чей `validFrom` ещё не наступил, разрешён, а закрытие — нет (`commands.ts:243-245` прямо говорит: «Для отмены нужно отозвать наряд») — это задумано, не дефект.
- Отказ и согласование намеренно не проверяют `readiness.permit.edit` (`commands.ts:219`), а проверяют approve-флаги — разделение обязанностей.
- По умолчанию (ORION) наряды не влияют на допуск: вес `PERMIT = 0`, блокеры `VALID_WORK_PERMIT_REQUIRED`/`PERMIT_EXPIRED` выключены (`domain/readiness-rules.ts:168,182,188`). При включённых правилах отзыв даёт `permitValid=false` (`application/readiness-score.ts:193-199`).
- Повторный отзыв безопасен: `updateMany` c `state='APPROVED'` → второй раз count 0 → 409.
- Маска аудита причину не вырезает: `revokeReason`/`rejectReason` отсутствуют в `SENSITIVE_KEYS` (`domain/audit/mask.ts:7-11`), в снимок попадают целиком — значит потеряна только выдача, а не хранение.

## Не проверено

- Запуск приложения и прогон тестов не выполнялись (`tsc`, `lint`, `test:unit`, `playwright`, `build` не запускались). Все выводы — из чтения кода и текстовых поисков.
- Фактическая работа `revoke`/`reject` на живой БД (транзакция, `updateMany`, цепочка аудита, пересчёт готовности) не воспроизводилась — ГИПОТЕЗА по эффектам готовности взята из чтения `readiness-score.ts:193-199`.
- Поведение под конкурентностью (два одновременных отзыва, отзыв+закрытие, отказ+подпись) выведено из чтения `updateMany`/`lockForApproval`, а не из испытаний.
- Экран не открывался: как вёрстка ведёт себя в реальном браузере (диалог, блокировка кнопок, мобильная карточка) — не проверено.
- Замороженные зоны (экраны оператора, ORION) не читались.
- Наличие в проде нарядов в состояниях `CLOSED`/`EXPIRED`/`REVOKED` и статистика отзывов/отказов не собирались (доступ к прод-БД агентам запрещён).
