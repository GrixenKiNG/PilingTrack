# ДЕФЕКТ: панель следующего шага перекрывает завершение осмотра V2

## Воспроизведение

На собственном PG18/Redis/MinIO и браузере Chromium, viewport 375×812, реальный цикл /operator/v2 проходит допуск и приёмку установки. В предсменном осмотре все 13 пунктов отмечены, кнопка «Завершить» доступна, но обычный click не проходит: NextStepDock перехватывает указатель. Assertions не ослаблялись, force/DOM-подмены/skip не применялись.

- RED на прикладном 46315b0f: v2-single-cycle-probe, exit 1, 26 секунд; сырые данные D:/PillingR/night-logs/night-evidence-1026/v2-probe-1-red/.
- Тест сохранён отдельным коммитом 1d0ff6e9.
- Первая правка 21dc26ce сделала внутренний footer статичным только внутри StepShell V2. Повтор v2-after-footer-probe: exit 1, 28 секунд; исправления оказалось недостаточно. Этот красный результат не заменён зелёным.
- Диагностический повтор v2-footer-geometry: exit 1, 27 секунд. Измерения сохранены в v2-footer-geometry-raw. Внутренняя панель position:static, кнопка y721–769. Внешняя sticky-обёртка y799–812 высотой всего13px. Nav.operator-tab-bar закреплён глобальным mobile CSS вне потока и перекрывает кнопку при предельной прокрутке scrollY291, documentHeight1103, viewport812.

## Минимальная правка

7a9dc8a7: StepShell V2 получает max-lg:pb-24 (96px нижнего отступа). Наряду с 21dc26ce меняются только классы оболочки V2, тексты и обработчики сохранены. Shared Screen/NextStepDock, остальные версии, правила допуска, записи и команды не изменены.

GitNexus impact StepShell: LOW, два вышестоящих символа, одна область operator-v2; прямой вызов OperatorShiftV2 и страница OperatorV2Page подтверждены исходником. Индекс отстаёт на6 коммитов; прежняя геометрия и новые классы подтверждены реальным браузером и diff. Полные detect_changes перед обоими коммитами: exit0, без partial/truncated; перед7a9:2символа,0affected,3файла. Нулевой affected не является доказательством отсутствия CSS-влияния.

## Проверка после

Сборка и повтор неизменённого сценария на7a9dc8a7 выполняются. До результата исправление не объявляется подтверждённым. Полные tsc/lint/unit/list отf51 относятся только к тому прикладному SHA. Полные проверки после последней UI-правки ещё нужны.

После7a9 сборка exit0; неизменённый v2-after-padding-probe дошёл через все три осмотра до WORK, затем отдельная проверка ширины RED:412>375, exit1/21s. Наложение осмотров больше не остановило сценарий; полный цикл всё ещё не подтверждён. Сырые данные v2-after-padding-red/.

Отдельный RED ширины локализован: v2-width-diagnostic exit1/20s, strong.oc-machine (имя установки с длинным идентификатором) right402.67 при viewport375; три переполненных элемента в одной шапке. 95f7c6b8 добавляет overflow-wrap:anywhere только для .oc-machine strong внутри StepShell V2. Shared header и другие версии не менялись. ImpactLOW2symbols/1module;detectexit0,2changed0affected4files,безpartial/truncated.

Первый GREEN после обеих локальных правок: v2-after-wrap-probe, приложение44126b987c9dd02b0bbefe28e8094f282b94aaf0,exit0/28с,1passed/0failed/0skipped. Хеш сценария26942793535e3eba276fdf02c97ebbea6eb25e350145475f9a6a477284909b83 совпадает с RED до правок,scenarioUnchanged=true. Все assertions и обычные клики сохранены,включая ширину≤375. Осмотры,ТБ,offline/replay,сваи2/бурение3м/простой0.25ч/инцидент/EO_AFTER/закрытие,ReportAudit/outbox/analytics и диспетчерская панель пройдены. Buildexit0/143с. Сырые данные v2-after-wrap-green/. Полная серия30 выполняется отдельно и пока не считается пройденной.

Финальный canonical-thirty-final на44126b98: все6V2 (три браузера×single/multiple) passed; общий набор30/0/0,exit0/1178с. Никаких force/skip/ослабленияassertions. OPERATOR-CYCLE.json.finalRun содержит все случаи.
