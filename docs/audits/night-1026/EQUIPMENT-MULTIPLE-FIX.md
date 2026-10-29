# Исправлено: журналы обеих назначенных установок доступны оператору

Ветка **codex/equipment-multiple-1029**, отдельная рабочая папка D:/PillingR/wt-equipment-multiple-1029. База — актуальный на старте main **17f235e54d4bb25bbde047929005a8fd612e685f**. Проверенный прикладной SHA — **084b9b25e9ed6aac2961997c7c737e6e447d6861**. В main ничего не вливалось, push/deploy/SSH/production не выполнялись.

## Что изменилось

Раньше getCrewForOperator выбирала первую бригаду пользователя, а два guard сравнивали её установку с запрошенной. При двух назначениях первая бригада не доказывала отсутствие второго назначения. Теперь query получает необязательный equipmentId и добавляет его как AND к прежнему OR operator/assistant; fuel и meter-readings передают запрошенный id.

Разрешение: TASK-EQUIPMENT-MULTIPLE-APPROVED.md, ровно три файла и строки из PERMIT-EQUIPMENT-MULTIPLE.md. **8b88ccca** — отдельный RED-коммит; **084b9b25** — отдельный fix-коммит, ровно 5 добавлений / 3 удаления в приложении. При удалении согласованных строк исходники побайтно возвращаются к RED: approved-source-proof.json. Tenant-фильтры, role/actingAs, isActive, права других ролей, auth/RLS/CSRF/rate-limiter, схема и зависимости не менялись. /api/crews/my и его двухаргументный вызов сохранены. equipment.document.updated не добавлялся.

| Файл приложения | Было строк | Стало |
|---|---:|---:|
|src/modules/crews/application/queries/crew-query.service.ts|103|105|
|src/app/api/equipment/[id]/fuel/route.ts|119|119|
|src/app/api/equipment/[id]/meter-readings/route.ts|128|128|

|src/modules/crews/application/queries/__tests__/crew-query.service.test.ts|73|110|
|src/app/api/equipment/[id]/meter-readings/__tests__/route.test.ts|132|174|
|src/app/api/__tests__/mutation-audit.test.ts|194|229|

Новых тестовых файлов и удалений файлов/экспортов нет. В трёх существующих тестовых файлах добавлены 23 проверки, проведены дополнительные mocks/imports. Прежние 83 теста сохранили успех. Полный перечень изменённых путей и строк — в git diff базы с веткой; исходные тестовые тела не переписывались.

## RED и обратная совместимость

- Исходные три файла query/meter/mutation-audit: **83 passed / 0 failed / 0 skipped**, exit 0, 5 с.
- После добавления контрактов: **88 passed / 18 failed / 0 skipped**, настоящий Vitest exit 1. Все прежние 83 по-прежнему passed, пять новых совместимых случаев прошли. Новые падения: шесть query, шесть meter и шесть fuel. Полный вывод — red-targeted.json/log и red-preservation.json.
- После только согласованной правки: **106 passed / 0 failed / 0 skipped**, exit 0, 5 с. Проверены пять role/actingAs сочетаний, отсутствие третьего аргумента и явный undefined, пустой equipmentId, GET/POST, отказы без read/write/audit и прежний ADMIN bypass.

Reflect.apply в новых query-тестах позволяет проверить будущий runtime-контракт третьего аргумента до изменения TypeScript-сигнатуры, без ts-ignore и преждевременной правки приложения. Все assertions сохранены после RED.

## Реальный браузер, SQL и аудит

На новой production-сборке084b9b25 выполнен существующий equipment multiple: в Chromium, Mobile Safari и Mobile Chrome: **3 passed / 0 failed / 0 skipped / 0 flaky**, exit 0, 41 с обёртка / 39.393 с Playwright.

В каждом из трёх случаев:

| Ресурс | Первая назначенная GET/POST | Вторая назначенная GET/POST | Неназначенная |
|---|---|---|---|
|meter-readings|200/201|200/201|Отказ403/404|
|fuel|200/201|200/201|Отказ403/404|

SQL подтверждает ровно две MeterReading и две FuelLog с recordedById текущего оператора. В FeedbackEvent ровно четыре события: meter.reading.added ×2 и equipment.fuel.created ×2, actorId — оператор. Записей неназначенной установки нет. Назначения предварительно подтверждены SQL: две активные бригады этого оператора и организации. Паспорта обеих назначенных машин дают200, неназначенной404. HTTP не мокировался. Полные наблюдения каждого браузера: browser-verified.json; raw — prod/browser-raw.

## Проверки новой сборки

Новый npm run build: **exit 0, 231 с**. HTTP health подтвердил084b9b25. Затем команды выполнялись отдельно и последовательно; перед tsc удалялся только .next/dev/types, если существовал.

| Команда | Exit | Секунды обёртки |
|---|---:|---:|
|npx tsc --noEmit|0|57|
|npm run lint|0|68|
|npm run test:unit — свежая изолированная база, последовательные файлы|0|980|
|npx playwright test --list — default config|0|81|

Полный unit: **6052 passed / 0 failed / 0 skipped**, 529 файлов. Команда: npm run test:unit -- --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile=<внешний full-unit-run.json>. Собственные свежие PG18/Redis/HTTP, без фонового воркера. Source SHA/mtime/JSON проверены final-validate.cjs. Исторический реестр241: найдено241,прошло241,непрошедшие0; детали в final-validated-summary.json, отсутствующие имена не скрываются.

Playwright собрал **411 тестов / 30 файлов**, exit 0. Это сбор полного default-набора, не его исполнение. Отдельный запуск коллекции BASE не выполнялся; счётчик старого SHA за main17 не выдаётся. E2E/config/package к базе17 в этой задаче не менялись.

## Сохранённые красные попытки dev и порядок проверок

До production build выполнены две попытки браузерной проверки, как требовало задание. Dev с --webpack не поднял здоровый endpoint: instrumentation/ioredis не разрешил Node-модуль stream, /api/health500; браузер не запускался. В штатном dev с Turbopack сервер поднялся, но все три браузерных случая остановились на входе: /api/auth/login не был вызван. Результат **0 passed / 3 failed / 0 skipped / 0 flaky**, exit 1, 208 с. До целевых запросов к установкам эти случаи не дошли.

Отдельный read-only diagnostic: /login200, за8с признак гидрации формы не появился, console/request errors пусты; причина не установлена. Это не объявлено дефектом getCrewForOperator. Auth, конфиг, зависимости и тестовый login не менялись; assertions не ослаблялись. Raw и диагностика сохранены в dev-turbo/browser-raw и dev-login-diagnostic.json.

Из-за этих ограничений production-сборка фактически выполнена **перед успешной браузерной проверкой**. Отклонение от заданного порядка не скрывается. На production тот же сценарий и те же проверки прошли; dev-падения не превращены в зелёные и не удалены. Успех в dev-режиме и исправление его запуска здесь не заявляются.

## GitNexus, окружение и ограничения

До правки свежий impact: HIGH для getCrewForOperator — 6 символов, два guard, четыре HTTP-обработчика,28flow hits. Локальные guard:LOW,по два обработчика. HIGH заранее сообщён. Динамический /api/crews/my подтверждён текстом(callers.txt),не изменён. Общий бюджет flows индекса ограничен, отсутствие ребра не доказательство отсутствия потребителя.

Перед RED: tsc exit0/48с,lint exit0/63с;полная переиндексация127с,контроль requirePageAbility15callers;all/compare1changed/0affected/4filesLOW. Перед fix:полная переиндексация126с,контроль15,impactHIGH;all3changed/0зарегистрированныхaffected/3filesLOW,compare4changed/0зарегистрированныхaffected/7filesLOW. Эти нули не приняты за отсутствие риска: отдельно сохранены impactHIGH и проверены все четыре HTTP-обработчика. Все detect-ответы без partial/truncated/error. Перед финальным коммитом отчёта выполнена новая полная переиндексация: exit 0 / 269 с, контроль requirePageAbility — 15 callers, оба detect — exit 0 без partial/truncated; артефакты report-detect.json/report-compare.json. Нового whole-branch review и новых агентов нет.

Первый npm ci остановился с exit1 на postinstall db:generate из-за отсутствия DATABASE_URL_POSTGRES. Повтор npm ci --ignore-scripts:exit0,748пакетов,audit0. Отдельный db:generate:exit0,Prisma7.10.1; ранее разрешённое значение было только в окружении этой команды и не сохранялось. Содержимое .env и шаблонов не читалось, реальные пути автозагрузки отсутствуют. Для build и проверок использованы настоящие учётные данные собственных disposable PG18/Redis/MinIO и сгенерированные ключи fixtures в RAM. Рабочие3100/данные не трогались.

Полный общий Playwright, production, реальное оборудование и внешняя доставка этим точечным заданием не проверялись. Следующие задачи идут отдельными ветками от актуального main; результат этой ветки не означает, что они уже выполнены или изменения объединены.

Собственный production-test стенд после завершения проверок остановлен: проверены и удалены ровно 5 принадлежащих этому запуску контейнеров и 5 их анонимных томов (prod-before-cleanup.json, prod-after-cleanup.json).
