# V3: реальный legacy-отчёт и граница цикла смены

Статус: все 6 legacy-сценариев (три браузера × одна/две установки) и 3 проверки selector прошли на сборке44126b98:9passed/0failed/0skipped,exit0/168с. Канонический цикл V3 этим не доказан. Прежние попытки ниже — история.

## Факт

v3-legacy-probe-2:exit0,1passed/0failed/0skipped,24с, production build7a9dc8a7, новая изолированная fixture в собственнойPG18. Обычные клики: /operator/v3 → «Начало смены» → /operator/v3/report → выбор объекта/установки/марки →2сваи → «Отправить отчёт» → смена реальной сессии наDISPATCHER → отчёт в правой панели /admin/reports.

Проверены реальные Report.status=submitted, PileWork sum=2, OutboxEvent ReportSubmitted published=true/projected=true, ReportAnalytics.totalPiles=2, точный ReportAudit action=created/actorIdоператора, UI-доступ диспетчера к созданному отчёту. Не внешняя доставка Telegram.

Наблюдение из того же браузера: до отправки mobile/state.phase=IDENTITY,shift=null; после отправки такжеIDENTITY,shift=null. Report.shiftId=null. Dashboard не имеет ни одной кнопки «Следующий шаг». Список действий:Начало смены,Осмотр,Моточасы,Дефект,Фото,Отправить. Это две разные модели процесса. Отправка legacy-формы не доказывает СИЗ/инструктаж/знания, осмотры, пуск, закрытие канонической смены или offline clientCommandId.

## Сверка кода

- src/components/piling/operator-v3/operator-dashboard-v3.tsx:14–20,93,111–133: все пять быстрых действий ведут в /operator/v3/report с hash; «Начало смены» также открывает форму.
- src/app/(app)/operator/v3/report/page.tsx:11: shared ReportForm.
- src/components/piling/report-form/report-form.tsx:263–268: anchor inspection показывает ShiftInfo (параметры смены), а не канонический чек-лист осмотра; anchor defect оборачивает DowntimeSection. Нельзя объявить это тем же осмотром/дефектом из readiness только по подписи кнопки.
- src/modules/reports/application/commands/report-command.service.ts:299–332: legacy audit action created/updated в одной транзакции с отчётом/outbox.

Начальный новый тест ошибочно ожидал action=submitted, заимствованный из канонического цикла. Он упал exit1/13с уже после успешных persist/outbox/analytics. Причина установлена по коду; ожидание заменено на столь же строгое created с точным actorId. Код приложения не менялся, кандидат «нет аудита» отклонён. RED сохранён v3-legacy-first-red/, GREEN v3-legacy-probe-green/.

Сценарий оставлен в e2e/release-critical-path.spec.ts (44126b98), обе конфигурации установок проверены во всех трёх браузерах на44126b98 (финальный результат ниже). Окончательное решение о выравнивании V3 с канонической сменой — вопрос владельцу №9. Версия не удалялась и не объединялась.

## Первый полный браузерный набор — RED

v3-six-final фактически собрал9тестов:6legacy и3существующихselector (общийgrep v3:). Итог8passed/1failed/0skipped,exit1/150с,приложение44126b98. Пятьlegacyи3selectorпрошли;MobileSafari×multiple не отправилPOSTupsert за15с. На screenshot/snapshot строк свай нет,поле количества пусто,маркаQA C120.30осталась,submitdisabled «Добавьте хотя бы одну сваю…». Это ещё не установленный дефект приложения:нужно определить,почему ввод/добавление не состоялись. Сырьё v3-six-final-raw/. Следующиеcritical/gates НЕ стартовали:конвейер штатно остановился наRED.

Новыйтестусилен:количествоDOMровно2доadd,послеaddровнооднакнопкаудаленияточноймарки,submitenabled. НикакиеSQL/аудит/outbox/dispatcherassertionsнеудалены. Повтор5разMobileSafari×multiple выполняется. Кодприложениянеизменён.

## Диагноз RED: готовность фокуса в новом harness

Усиленный v3-input-repro-five дал2passed/3failed/0skipped,exit1/96с:значение поля уже пустое сразу послеfillдоadd. v3-input-trace-three дал0passed/3failed,exit1/50с. Во всех трёх захвачены только focusin→focusout через3–4мс,ни одногоinput/change;элементоставалсяconnected. Это не доказательство потери сохранённой строки приложением:ввод в поле вообще не поступил. Контроль безприложения на томжеWebKit:20native+20React-controlled number полей,40/40passed,exit0/17с.

В установленном @radix-ui/react-select onUnmountAutoFocus возвращаетfocus наtrigger; @radix-ui/react-focus-scope выполняетэточерезsetTimeout0. Новый тест вводил число сразу послеoption.click,до окончания возвратафокуса. Исправлен только harness:ожиданиеtoBeFocused уcomboмаркидоfill,плюссохраненыновые строгие value=2/rowcount=1/submitenabled. Никакогоforce/focus()/таймаута/повтора ввода внутрисценария. v3-focus-ready-five:5passed/0failed/0skipped/0flaky,exit0/129с,всеSQL/audit/outbox/dispatcherassertionsсохранены. Коммит86358ae3;кодприложенияНЕменялся. Причинапервогоновоготеста классифицированакакharness,неДЕФЕКТприложения. ИсходныеREDнезатёрты.

Оставшиесястадииперезапущеныотдельноui-final-remainder:сначалаполные9V3 (6legacy+3selector),затемсвежиеcritical/gates. Зелёные30каноническихнеповторяются,ихtesthashиappSHAнеизменились. Build44126b98,тесты86358ae3;gitdiffмеждуэтимиSHAпоsrc/prisma/package*/next.configпуст,exit0,ui-final-app-source-pin.json. Этоявнаяпривязкакомпилированногоприложенияитекущихтестов,непереносстарогобилданаизменённыйприкладнойкод.

## Итог на едином приложении44126b98

v3-nine-final-2:9passed/0failed/0skipped/0flaky,exit0/168с wrapper (165.73сPW),scenarioUnchanged=true. Шесть настоящих legacy-отчётов×три браузера×single/multiple и три selector-check. Во всехшестиphaseIDENTITYдо/после,Shift=null,Report.shiftId=null;report/auditcreated/outbox/analytics/диспетчерпрошли. Поимённые результаты V3-LEGACY.json. Это подтверждённый legacy-путь всех трёх браузеров,а не канонический цикл смены. Старый8/1/0RED и5повторовегоharnessдиагнозасохранены.


## Повтор на451acce2

9passed/0failed/0skipped/0flaky,exit0/190с;equipment-v3-nine-raw. В шести реальных legacy-отчётах status=submitted,shiftId=null,phaseIDENTITYдо/после. Три selector доступны. Канонический цикл не добавлен,вопрос№9 не снимается.
