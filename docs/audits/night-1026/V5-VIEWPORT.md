# ДЕФЕКТ v5: длинное название расширяет мобильный viewport

На приложенииf51b0f30,при видимой ширине375px,полный V5-прогон дал5passed/1failed/0skipped,exit1. В MobileChrome перехватывались клики по чек-листуТБ;повторные focused/диагностические запуски сохранены без объявления их новым полнымGREEN.

Read-only DOM-измерения локализовали источник:oc-machine strong шириной319,47px при доступных273,81px,правый край407,06px. App/scr имеют375px,но scrollWidth407px. VisualViewport остаётся375×812,innerWidth407/innerHeight882,смещаютсяoffsetLeft/offsetTop;в результате меняются координаты попадания по кнопкам. Исходный тест использовал обычные клики,безforce и без измененияDOM.

В существующий night-operator-cycle.spec.ts добавлены V5-case и проверка ширины документа≤375. ДетерминированныйRED:0passed/1failed/0skipped,exit1/20с,фактически394px. RED-тест сохранён e4b43878;исторические5/1 и все диагностические raw/screenshot/scenario —v5-six-red/,v5-hit-red/,v5-viewport-red/,v5-overflow-red/,v5-overflow-assert-red.*.

Коммит46315b0f:только четыре строкиCSS вsrc/app/operator/v5/operator-v5-app.css —правило .v5 .oc-machine strong { overflow-wrap:anywhere; }. Общий TSX-заголовок,тексты,данные и обработчики не менялись.

GitNexus общего OperatorMachineHeader вернулCRITICAL(12узлов,6модулей,3процесса);владелец предупреждён. Общая функция не меняется;локальный stylesheet имеет единственный импорт src/app/operator/v5/page.tsx. CSSFile impactUNKNOWN подтверждён текстом. Full detect перед CSS-коммитом:0symbols/0affected/1file,LOW,безpartial/truncated;ноль не принят за отсутствие CSS-влияния.

Пересборка иGREENна46315b0f сейчас выполняются. До фактического результата исходныйREDне заменяется успехом. Фикс SQLf51 полностью проверен5776/0/0 отдельно;его fullunit/build не переносятся на новыйCSS-SHA.

GREEN:тот же scenarioSHA256e30f5512915b9af9429f6e4c07344f662a1de812f33a718f5e0a2446027fb377,приложение46315b0f:focused1passed/0failed/0skipped exit0/29с;полныйV5на3браузерах×single/multiple —6passed/0failed/0skipped exit0/253с. Нормальные клики и все прежние SQL/queue/replay assertions сохранены. Новая production-сборка463 exit0/149с;полныеunit/tsc/lint/listдляновогоCSSещёнепроведены.

Финальный canonical-thirty-final на44126b98 повторил все6V5 вместе с остальными4версиями:30passed/0failed/0skipped,exit0/1178с. ИсходныеRED и focused/fullGREEN на463 сохранены отдельно.
