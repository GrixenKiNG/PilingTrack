# Полный осмотр механиком: браузер, файл и транзакции

Прикладная сборка **44126b987c9dd02b0bbefe28e8094f282b94aaf0**. Проверенный файл теста SHA256 **003f74a2804d3a5e862e771db4291a6f624779294aa1cb85f1ccbd740f038827**; рабочий HEAD при запуске fcc5b0d6cda4b55490076016708edfb338fc1187 с явно записанной незакоммиченной добавкой теста. src/prisma/package*/next.config.ts относительно сборки не менялись. После проверок тест и этот отчёт коммитятся вместе.

| Проверка | Exit | Passed / failed / skipped | Время |
|---|---:|---|---|
| Весь inspection-to-flow.spec.ts: Chromium, Mobile Safari, Mobile Chrome |0|**12 / 0 / 0**, flaky0; 3 новых +9 прежних|214.3с PW / 246с fresh wrapper|
| npx tsc --noEmit |0|—|15с|
| npm run lint |0|0 ошибок / 0 предупреждений|62с|
| npx playwright test --list |0|390 тестов / 30 файлов против BASE 318 / 28; оба exit0|37с wrapper|

## Что выполнено действием

Механик вошёл своей синтетической сессией. Для своей установки увидел два реально собранных блока База+Молот. Создал ЕО с101моточасом: Inspection DRAFT/performedById механика, связанный MaintenanceRecord IN_PROGRESS/createdById того же пользователя. Это отдельный механический Inspection вне смены; он не подменяет OperatorChecklistExecution канонического экрана.

Через формы заполнены все четыре типа ответов: YES_NO,STATUS4,DONE,MEASURE. Первый ответ и примечание сохранены кнопкой черновика; перезагрузка восстановила сохранённый текст, SQL подтвердил YES и примечание. Фотография — настоящие PNG-байты: браузер выполнил presign→PUT в собственный MinIO→confirm. Media имеет completed/userId механика/fileSize; скачанные по штатной ссылке байты полностью совпали с исходными. Завершённый ответ сохраняет photoCount=1.

После трёх разделов механик подписал осмотр. SQL:COMPLETED,5ответов,photoCount1 у нужного пункта,measure12,healthScore100,подпись/время; связанный наряд DONE. Equipment.engineHoursTotal101 и ровно одна MeterReading MANUAL101 с recordedById механика и примечанием «Снято при осмотре EO». FeedbackEvent содержит по одному inspection.started/inspection.completed с точным actorId. Worker создал INSPECTION_COMPLETED snapshot с inspectionId,inspectionCompleted=true,healthScore100,meterKnown=true; закрытого наряда нет среди открытых maintenanceRecordIds.

Повтор complete возвращает первоначальную подпись и дату. История моточасов остаётся буквально той же одной строкой, второго inspection.completed в аудите нет. Ответы в завершённой форме отключены, кнопки сохранения нет. Диспетчер другой сессией видит тот же COMPLETED/автора/примечание. Назначенный на ту же установку OPERATOR получает404 на чужой осмотр, ASSISTANT403; прямые URL показывают отказ без примечания. Все три браузера проверили эти действия;pageerror=[] в каждом.

## Реальные границы

healthScore100 — результат синтетических положительных ответов, а не доказательство полного READY или исправности физической машины. Для полного допуска есть другие критерии. Здесь два блока EO; ROTARY и каждый уровень ТО не объявляются заполненными. Галерея завершённого осмотра отдельно не проверялась на запрет изменения: read-only выше относится к ответам. Проверены один свой tenant и отказы двум ролям на чужой по исполнителю осмотр; все tenant/ресурсные сочетания этим не покрыты.

Предыдущие девять сценариев не переписаны: их исходные тела до добавки побайтово совпадают с fcc5b0d6, добавлен лишь import fixture. Они проверяют неактивную историю готовности, старт ТО-1/черновик и выбор блока молота в ТО-3. Никаких skip/fixme не добавлено; в текущих12 пропусков нет.

## История проверок

mechanic-first:1failed/0passed/0skipped,exit1/18с. Вся бизнесцепь до смены роли прошла, затем APIlogout оставил старую оболочку с session-probe, перехватившей следующий login. Новый тест закрывает старую страницу и открывает следующую в том же browser context/device. Все assertions сохранены; код приложения не менялся. mechanic-session:1/0/0,exit0/24с.

Первый fresh12:12/0/0,exit0/265с,cleanup=true. tsc0/15с;lint exit0/63с с ОДНИМ предупреждением нового non-null assertion;такой lint не объявлен готовностью. Assertion заменён безопасным извлечением строки ID и проверкой непустоты, добавлены история моточасов и неизменность при replay. После этого повторены все12 и отдельные tsc/lint/list из верхней таблицы. Старые RED и warning-log сохранены.

В серверном логе первого fresh наблюдался MaxListenersExceededWarning в Next compression/httpxy на Node26. Это не доказанная утечка памяти; профилирование не выполнялось. Browser pageerror отсутствовали. Зависимости и серверный код ради предупреждения не менялись.

## Повтор и сырьё

В собственном disposable runtime: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/inspection-to-flow.spec.ts --trace=off. Перед этим штатные disposable-seed/to/extra fixtures и миграции deploy на совершенно новой собственной PG18. Пароли только в RAM; .env не читался/не создавался. Сценарий проверяет владельца PG перед fixture.

Точная команда и exits:inspection-confirmed-pipeline-result.json; источник/порты без credentials:inspection-confirmed-fresh-public.json; сырьё inspection-confirmed-fresh-raw/playwright.json/browser и уникальные inspection-confirmed-app/workers.log. FreshPG/2Redis/app/worker очищены:cleanup=true,cleanupErrors=[]. Рабочий3100 не использован. Новая генерация unit/build из-за E2E не запускалась; последняя та же прикладная сборка имеет5776/0/0 иbuildexit0/143с.
