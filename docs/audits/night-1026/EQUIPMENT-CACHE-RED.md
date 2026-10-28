# ДЕФЕКТ P3: новая установка не появляется в парке после создания

Прикладной SHA 451acce2b30e5130a9055e9d966edcf4a413ff67, HEAD тестов до нового дополнения ea9a64f2a5893607f4f63b6309a0129b0d9d1f7c. Реальные ADMIN/Chromium, собственные fixtures и PG18/Redis, HTTP без моков. Код приложения пока не изменён.

UI заполняет паспорт, модель/инвентарный/серийный/VIN и характеристики, наработку100ч/бак400л/следующееТО150ч. Создание POST /api/equipment даёт201; SQL подтверждает все эти значения и активный статус. В MeterReading создана начальная запись100 с recordedById ADMIN, в FeedbackEvent equipment.created с actorId ADMIN.

После закрытия диалога UI refetch /api/monitoring/fleet получает прежний снимок. Поиск по новому инвентарному номеру показывает «Нет установок под выбранные фильтры». Обычный GET200 содержит 1 установку, диагностический GET200 с _ts — 2, включая созданную. _ts используется только для диагностики; UI-assertion по-прежнему требует появления новой записи без обхода кеша. JS errors=[]; assertions не ослаблены.

Два свежих повтора: первый UI RED equipment-lifecycle-first-red-raw; второй с диагностикой equipment-cache-confirmed-red-raw. Оба exit1/40с,0passed/1failed/0skipped/0flaky,cleanup=true. Второй Playwright 12.176с. Полный JSON/скриншот/сценарий/логи сохранены до следующего запуска. Команда из equipment-probe-fresh-stand.cjs: node e2e/fixtures/disposable-https.mjs node_modules/@playwright/test/cli.js test --config=playwright.night.config.ts e2e/release-critical-path.spec.ts --trace=off --grep 'equipment lifecycle:' --project=chromium.

## Причина и минимальная правка

AdminEquipment показывает useFleet.snapshot, после создания вызывает refetch(). useFleet читает обычный /api/monitoring/fleet; GET кешируется30с. POST /api/equipment сохраняет данные и аудит, но не инвалидирует этот снимок. Ответ стареет в тот момент, когда UI просит обновление после собственного изменения.

Предлагаемая правка только src/app/api/equipment/route.ts: import getResponseCache из @/core/cache и перед успешным201 после сохранения/аудита getResponseCache('monitoring').invalidate('GET:/api/monitoring/fleet'). Две добавленные строки; бизнес-команды, tenant/auth/CSRF/rate, схема, формат ответа и TTL не меняются. Общий кеш и wrapper не редактируются. Это разрешённое исходным заданием исправление воспроизведённого дефекта; запрошенное отдельно исключение getCrewForOperator к нему не относится.

GitNexus impact точного POST UID — UNKNOWN/0callers, не принят как безопасность. Текст подтвердил useEquipmentList.create → POST /api/equipment; AdminEquipment.create → refetch; useFleet → monitoring/fleet. Артефакты equipment-cache-post-impact.json иequipment-cache-callers.log. File impact E2E тожеUNKNOWN; testMatch и прежняя коллекция405 подтверждают живой entrypoint.

Четыре прикладных источника сравниваются с базой efd95008eac3bc846c89003c4b7766f2eb5c1c9b в JSON. Это статическое сравнение; HTTP на BASE для нового сценария не запускался. Старые build/unit451 остаются историей неизменённого приложения, но не означают зелёный новый UI-case.

## Что ещё не доказано

Этот RED остановился после создания. Редактирование паспорта/100→110,списание/возврат,права механика,удаление с историей и readiness пока не достигнуты. Подготовленный сценарий содержит эти проверки, но наличие кода не считается прохождением. Отдельный P3 двух назначенных установок остаётся открытым, разрешение на его query ещё ожидается. Задача6 частична.


## Проверки перед RED-коммитом кеша

Команды отдельно и последовательно: npx tsc --noEmit exit0/14с (предварительно удалён только.next/dev/types,еслибыл); npm run lint exit0/62с без предупреждений; npx playwright test --list черезfreshwrapper exit0/34с,408тестов/30файлов противBASE318/28,обаexit0. Новый UIcase0passed/1failed/0skipped/0flaky exit1/40с. Source451 неизменён; полный unit5783/0/0 иbuild0/151с не повторялись для E2E-only RED,не объявляют новый UI зелёным.

Перед коммитом полнаяforceпереиндексация,контрольUID/callers requirePageAbility,all+compare на точномWT. Полные артефакты equipment-cache-red-graph-results.json / detect-equipment-cache-red.json / compare-equipment-cache-red.json,безpartial/truncated/error. Общий compareHIGHсемиV3 заранее сообщён;это не объявление всего приложения безопасным. Новый reviewer не запускался.
