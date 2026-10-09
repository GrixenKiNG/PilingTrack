# AU34-S3-OPERATOR-VARIANTS-MAP: Карта вариантов экрана машиниста — что общего и чем отличаются

Версия кода (git rev-parse HEAD рабочей папки): `2306d5c97ae290186f57fde9ab1304e07191194a`
Ветка: `hermes/q4-0926`. Дата прогона: 09.10.2026.
Только чтение: ни один файл приложения не менялся. Зона заморожена (AGENTS.md §1), варианты не предлагается удалять.

## Итог

- Разобрано 8 маршрутов: `/operator`, `/operator/v2`, `/operator/v3`, `/operator/v5`, `/operator/v7`, `/operator/v10`, а также помощник (`/assistant`, `/operator/v7/assistant`) и история (`/history`, `/operator/v7/history`).
- Пять «боевых» вариантов машиниста (`/operator`, v2, v5, v7, v10) построены на ОДНОМ расчёте шагов — `shift-next-step.ts` (TOTAL_STEPS = 7) и ОДНОЙ панели `step-bar.tsx` с кнопкой «Следующий шаг»; различаются только визуальной оболочкой и своей навигацией. ПРОЙДЕНО.
- Три «выпадающих» варианта: `/operator/v3` (старый отчётный экран, без shift-next-step, своя 4-шаговая модель, без офлайн-очереди), `/assistant` и `/operator/v7/assistant` (у помощника смены нет — так и задумано).
- Кнопка «Следующий шаг» есть на всех пяти вариантах машиниста и НЕТ на v3 и помощнике.
- Офлайн-очередь есть на всех пяти вариантах машиниста и НЕТ на v3, помощнике и истории.
- Самые важные расхождения (важно): (1) запись ДЕФЕКТА вручную есть только у v2 и у `/assistant`; на `/operator`, v5, v7, v10 дефект только читается/создаётся из ответов осмотра; (2) шапка файла `src/app/operator/v7/page.tsx` говорит «Действий не выполняет», хотя v7 действия выполняет; (3) тот же файл ссылается на маршрут `/operator/module`, которого в коде нет.
- Ни на одну версию нет пункта меню: все открываются только прямым адресом (ссылок `/operator/v*` в `src` вне самих маршрутов нет). ПРОЙДЕНО grep-ом.
- Всего находок: критично — 0, важно — 6, мелочь — 7 (13 в таблице).

## Методика

Что искал и как (команды можно повторить из корня воркбука):

1. Список файлов и маршрутов вариантов:
   `find src/app/operator -type f | sort`
   `find "src/app/(app)/operator" -type f | sort`
   `find src/components/piling -type f -path '*operator*' | sort`
   `find src/modules/operator-mobile -type f | sort`
2. Маршрут → компонент: прочитаны все `page.tsx` в `src/app/operator/**` и `src/app/(app)/operator/**`.
3. Общий расчёт шагов: `grep -rn "shift-next-step|shiftNextStep" src e2e tests`
   Кто зовёт `nextStep(`/`finishShift(`: `grep -rn "nextStep\|finishShift" src/components/piling/...`
   Кто рендерит `StepBar`: `grep -rn "step-bar\|StepBar" ...`
4. Своя навигация: `grep -rniE "dock|tab-bar|tabbar|bottom-nav|nav-bar" <файл>` по каждому варианту.
5. Офлайн-очередь: `grep -rn "use-offline-queue\|useOfflineQueue\|offline-queue" src/components/piling/operator-*`.
6. Кнопка «Следующий шаг»: `grep -rn "Следующий шаг" src/components/piling/...` (текст кнопки в `step-bar.tsx:125`).
7. Размеры кода и тестов: `wc -l` по компонентам; тесты — подсчёт `it(`/`test(` по файлам `*.test.ts(x)` командой `grep -cE "^\s*(it|test)\("`.
8. Матрица функций — по импортам и командам: `grep -n "import" <component>`; запись дефекта — `grep -rn "readiness/defects\|DefectSheet\|AssistantDefectForm"`; список команд смены — `Command` в `src/components/piling/operator-mobile/api.ts:460-472`.
9. Гейтинг роли и раскладка: `src/app/(app)/layout.tsx`, `src/app/(app)/operator-layout-policy.ts`, `src/app/(app)/__tests__/operator-layout-policy.test.ts`.
10. Покрытие e2e: `e2e/qa/operator-versions.spec.ts` + матрица `D:/PillingR/qa/matrix.json` (QA-фикстура вне репо).

Оговорки к методике: тесты посчитаны статически (по `it(`/`test(`), без запуска vitest — число совпадает с «объявленными» тестами, но могли быть `it.each`, раскрывающиеся до нескольких прогонов (в `src/app/(app)/operator/v2/page.test.tsx` один `it.each` на 5 ролей считается как 1). Числа строк кода — из `wc -l`.

## Карта вариантов машиниста (и соседей)

| маршрут | компонент (файл) | общий расчёт шагов (shift-next-step) | своя навигация | офлайн-очередь | кнопка «Следующий шаг» | строк кода | тестов |
|---|---|---|---|---|---|---|---|
| `/operator` | `operator-mobile-app.tsx` (1120) | да — `nextStep`/`finishShift` (`operator-mobile-app.tsx:625`) | да — `TabBar` (`:722`); общая панель layout скрыта политикой | да — `use-offline-queue` (`:14`) | да — `StepBar` (`:665`) | 1120 основной; 7996 — весь общий модуль `operator-mobile/` (без `v7/`,`v10/`) | 201 (общий набор `operator-mobile`) |
| `/operator/v2` | `operator-shift-v2.tsx` (1357) | да (`operator-shift-v2.tsx:777`) | да — своя `<nav>` (`operator-v2/ui.tsx:200`); layout-панель скрыта | да (`operator-shift-v2.tsx:65`) | да — `StepBar` (`:801`) | 1357 основной; 2549 — весь каталог `operator-v2/` | 25 в модуле (+2 в тесте страницы маршрута) |
| `/operator/v3` | `operator-dashboard-v3.tsx` (199) | НЕТ | НЕТ — берёт общую нижнюю панель layout (`operator-layout-policy.ts` не включает v3) | НЕТ | НЕТ | 199 | 0 |
| `/operator/v5` | `operator-v5-app.tsx` (1509) | да (`:1249`) | да — `Dock` (`:90`, `:1505`); маршрут вне `(app)` | да (`:29`) | да — `StepBar` (`:1491`) | 1509 основной (+805 CSS) | 20 |
| `/operator/v7` | `operator-v7-app.tsx` (608) | да (`:273`) | да — `Dock` (`:259`) | да (`:15`) | да — `StepBar` (`:289`) | 608 основной; 3044 — весь каталог `v7/` (+640 CSS) | 6 |
| `/operator/v10` | `operator-v10-app.tsx` (1718) | да (`:1702`) | да — `Tabbar` (`:1711`) | да (`:27`) | да — `StepBar` (`:1700`) | 1718 основной (+197 UI, +253 CSS); 1915 каталог | 26 |
| `/assistant` (помощник) | `assistant-app.tsx` (346) | НЕТ (смены нет по замыслу) | НЕТ своей панели; layout-панель скрыта политикой | НЕТ | НЕТ | 346 | 0 |
| `/operator/v7/assistant` | `assistant-v7-app.tsx` (320) | НЕТ | да — `Dock` (`v7/assistant-v7-app.tsx:201`) | НЕТ | НЕТ | 320 | 0 |
| `/operator/v7/history` | `history-v7-app.tsx` (180) | НЕТ | НЕТ (только «назад» `:125`, `PhoneShell` без dock) | НЕТ | НЕТ | 180 | 0 |
| `/history` | `report-history.tsx` (388) | НЕТ | НЕТ (общая панель layout) | НЕТ | НЕТ | 388 | тест сервиса: `src/services/reports/__tests__/report-history-service.test.ts` |

Числа строк — из `wc -l` (см. Методику п.7). «Своя навигация» = собственная нижняя панель, из-за которой общая панель `(app)/layout.tsx` скрыта политикой `operatorRouteOwnsNavigation` (`src/app/(app)/operator-layout-policy.ts:11-16`).

## Матрица функций: вариант × функция

Легенда: есть / нет / частично (с пояснением). Запись выработки = команды `log-production` с типами `PILES`/`PILE_PASSPORT`/`DRILLING`/`DOWNTIME` (`api.ts:453-458`). Отдельной команды «дефект» в контуре смены НЕТ: дефект либо создаётся автоматически из ответов осмотра (`application/commands/checklist.ts:175` `collectDefectDrafts`), либо пишется вручную только через `/api/readiness/defects` (`assistant-defect-form.tsx:58`, `operator-v2/defect-sheet.tsx:54`).

| вариант | записать сваю | бурение | простой | дефект | инцидент | осмотр | допуск | сдача |
|---|---|---|---|---|---|---|---|---|
| `/operator` | есть | есть | есть | частично: своего ввода нет, вкладка «Техника» только читает (`operator-mobile-app.tsx:740`); дефекты рождаются из осмотра | есть | есть | есть | есть |
| `/operator/v2` | есть | есть | есть | есть: `DefectSheet` пишет в `/api/readiness/defects` (`defect-sheet.tsx:54`, вызов `operator-shift-v2.tsx:1205`) | есть | есть | есть | есть |
| `/operator/v3` | нет | нет | нет | частично: кнопка «Дефект» → форма отчёта `/operator/v3/report#defect` (`operator-dashboard-v3.tsx:21,93`) | нет | частично: кнопка «Осмотр» → `/operator/v3/report#inspection` | нет | частично: кнопка «Отправить» → сдача отчёта |
| `/operator/v5` | есть | есть | есть | частично: вкладка «Дефекты» только читает (`operator-v5-app.tsx:1316-1327`) | есть | есть | есть | есть |
| `/operator/v7` | есть | есть | есть | частично: `EquipmentScreen` только читает (`v7/v7-screens.tsx:446`) | есть | есть | есть | есть |
| `/operator/v10` | есть | есть | есть | частично: строки дефектов только читаются (`operator-v10-app.tsx:587-591`) | есть | есть | есть | есть |
| `/assistant` | нет | нет | нет | есть: `AssistantDefectForm` пишет в `/api/readiness/defects` (`assistant-app.tsx:326`) | нет | нет | есть (инструктаж, знания, допуски) | нет |
| `/operator/v7/assistant` | нет | нет | нет | частично: только чтение (`v7/assistant-v7-app.tsx:229-242`), команд только `acknowledge-briefing` и `submit-knowledge` (`:179,185`) | нет | нет | есть | нет |

Основание «есть» для записи выработки: v1 — `screens/work-screen.tsx` + `screens/pile-passport-form.tsx`; v2 — `operator-v2/sheets.tsx` (`PileSheet`,`DrillingSheet`,`DowntimeSheet`) + общий `PilePassportForm`; v5 — те же общие `PilePassportForm`/`KnowledgeScreen` (`operator-v5-app.tsx:19-20`); v7 — `v7-shift.tsx` (`ProductionFlow`, `EntryKind` = `PILES`/`PASSPORT`/`DRILLING`/`DOWNTIME`, `v7-shift.tsx:122`); v10 — свои потоки + общий `PilePassportForm` (`operator-v10-app.tsx:29`).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/app/operator/v7/page.tsx:13` | Комментарий маршрута: «Действий не выполняет», хотя v7 выполняет команды | Файл говорит одно, код — другое: `operator-v7-app.tsx:165` вызывает `sendCommand`, а шапка самого компонента (`operator-v7-app.tsx:28`) прямо пишет «с действиями». Читающий/ревьюер получит неверную картину | Привести комментарий маршрута в соответствие с `operator-v7-app.tsx` (v7 действия выполняет) |
| 2 | важно | `src/app/operator/v7/page.tsx:10` | Ссылка на несуществующий маршрут `/operator/module` | В `src/app/operator/` лежат только `v5`, `v7`, `v10` (проверено `ls`); маршрута `/operator/module` нет. Комментарий описывает то, чего не существует | Убрать/поправить упоминание `/operator/module` |
| 3 | важно | `operator-v2/defect-sheet.tsx:54` vs `operator-mobile-app.tsx:740`, `operator-v5-app.tsx:1320`, `v7/v7-screens.tsx:446`, `operator-v10-app.tsx:587` | Ручная запись дефекта есть только у v2 (и у помощника `/assistant`); на `/operator`, v5, v7, v10 дефект только читается | Машинист на `/operator`/v5/v7/v10 не может завести неисправность иначе как «уронив» её из ответов осмотра. Если владелец выберет один из этих вариантов, функцию придётся добирать | Решить, входит ли ручная запись дефекта в эталон; при выборе варианта — выровнять |
| 4 | важно | `src/app/(app)/operator/v3/page.tsx:11` + `operator-dashboard-v3.tsx` | v3 — единственный вариант машиниста вне контура `shift-next-step` и вне «Матрицы QA» | v3 не в `D:/PillingR/qa/matrix.json` (там `operator`,`v2`,`v5`,`v7`,`v10`) и `operator-versions.spec.ts:10` его не гоняет — в e2e он не проверяется вовсе; плюс своя 4-шаговая модель (`operator-dashboard-v3.tsx:23` `SHIFT_STEPS`) | Не удалять; зафиксировать в отчёте, что v3 вне QA/e2e, решать владельцу |
| 5 | важно | `src/app/(app)/operator/v3/page.tsx:11` + `operator-dashboard-v3.tsx:36` | У маршрута v3 нет проверки роли на клиенте и рендера 403 | v2 проверяет роль (`v2/page.tsx:12-13`), v1/v5/v7/v10 показывают отказ по 403 от API (`operator-mobile-app.tsx:259`, `operator-v5-app.tsx:1014`). v3 опирается только на общий layout | Проверить, нужен ли v3 клиентский гейт роли, как у v2 |
| 6 | важно | `operator-dashboard-v3.tsx:47-48` | v3 тянет данные с `userId=` в строке запроса | `authFetch('/api/sites?userId=...')` и `/api/reports/my?userId=...`. Сервер это валидирует (`report-query.service.ts:277` `resolveUserScope(..., 'reports.read_cross_user')`), так что дыры нет, НО это единственный вариант, где `userId` уходит в query — неформатный шаблон рядом с остальными | Отметить как отклонение стиля; по желанию — не слать `userId` из UI |
| 7 | мелочь | `src/app/(app)/operator-layout-policy.ts:12-15` | Политика «своего низа» перечисляет только `/operator`, `/assistant`, `/operator/v2` | `/operator/v5`, `/operator/v7`, `/operator/v10` в списке нет, но они и так вне группы `(app)`. `/operator/v3` в группе и своего низа не имеет — берёт общий. Работает, но список неполон концептуально | Оставить; список покрыт тестом `operator-layout-policy.test.ts:5-13` |
| 8 | мелочь | `src/app/(app)/layout.tsx:49-50` | Особый случай: на `/operator/v3` пункт меню `/operator` переписывается на `/operator/v3` | Единственный маршрут с такой подменой href. Работает, но это скрытая связка layout↔v3 | Оставить, зафиксировать как факт |
| 9 | мелочь | поиск ссылок `/operator/v(2|3|5|7|10)` в `src` | Нет ни одной навигационной ссылки на варианты | `grep` нашёл только сами маршруты и `layout.tsx:49`. Попасть в v2/v5/v7/v10/v3 можно лишь прямым адресом — это соответствует замыслу «кандидаты», но переключиться из UI нельзя | Оставить (решение владельца) |
| 10 | мелочь | `operator-mobile/assistant-app.tsx:116` | `/assistant` рисует `Screen` без `tabs` и не имеет своей нижней панели, при этом политика скрывает общую панель layout | На маршруте помощника нет нижней навигации вообще. По смыслу (одна задача — инструктаж) это допустимо, но стоит подтвердить | Оставить; при желании — дать помощнику свой низ |
| 11 | мелочь | `v7/history-v7-app.tsx:120,125` | `/operator/v7/history` — `PhoneShell` без `dock`, выход только кнопкой «назад» | Тупиковый по навигации экран истории: вернуться можно лишь в `/operator/v7` | Оставить; при желании — добавить dock |
| 12 | мелочь | `e2e/qa/operator-versions.spec.ts:10` | e2e-спек вариантов гоняет только версии из матрицы QA | `matrix.operatorVersions` = `operator,v2,v5,v7,v10` (5 версий × 2 роли = 10 тестов). v3 в e2e не проверяется | Отметить покрытие в отчёте; решать владельцу |
| 13 | мелочь | `source: гипотеза` `operator-v5/operator-v5-app.tsx:19-20` vs `operator-mobile/screens/*` | v5 переиспользует всего 2 общих экрана (`KnowledgeScreen`, `PilePassportForm`), а v1 — весь набор `screens/` | Это источник расхождений поведения между v1 и v5 (напр. разные формы осмотра). Не ошибка, но объясняет, почему «единый контур» на деле расходится в деталях. Места расхождений не перечислены построчно | При выборе эталона — сверить v5 с v1 по каждому экрану |

Итог по severity: критично — 0, важно — 6 (#1–#6), мелочь — 7 (#7–#13).

## Что проверено и как (статусы)

- ПРОЙДЕНО: маршрут → компонент — прочитаны все `page.tsx` в `src/app/operator/**` и `src/app/(app)/operator/**`.
- ПРОЙДЕНО: наличие/отсутствие `shift-next-step` и `StepBar` — grep + чтение мест вызова с номерами строк.
- ПРОЙДЕНО: офлайн-очередь — grep импортов `use-offline-queue`.
- ПРОЙДЕНО: число строк — `wc -l`; число тестов — статический подсчёт `it(`/`test(`.
- ПРОЙДЕНО: запись дефекта — grep `readiness/defects`/`DefectSheet`/`AssistantDefectForm` по всем вариантам.
- ПРОЙДЕНО: отсутствие ссылок на варианты — grep `/operator/v(2|3|5|7|10)` по `src`.
- ГИПОТЕЗА: #13 — расхождение поведения v5 и v1 выведено из разного набора импортируемых общих экранов, построчно не сверялось.
- НЕ ПРОВЕРЕНО: рантайм (ни vitest, ни playwright не запускались — задача read-only карта; тесты посчитаны статически).
- НЕ ПРОВЕРЕНО: текст `D:/PillingR/qa/matrix.json` — внешняя QA-фикстура вне репозитория; прочитана для контекста покрытия, не является кодом PilingTrack.

## Не проверено

- Числа тестов не подтверждены запуском (`npx vitest run` / `npx playwright test --list`) — только статический подсчёт по исходникам. `it.each` может считаться как один.
- Не проверялись фактическое поведение и скриншоты вариантов на живых данных (нет доступа к БД/серверу; read-only задание).
- Не сверялись построчно расхождения экранов v5 ↔ v1 (см. #13) — только факт разного набора импортов.
- Не проверялось, какой вариант владелец считает эталоном и какие из пяти «боевых» уже приняты — вне кода.
- Не проверялись CSS-файлы на дублирование правил (только подсчёт строк: `v5/*.css` 805, `v7/*.css` 640, `v10/*.css` 253, `operator-concept.css` 83, `operator-type.css` 55).
- Раздел «Матрица функций» по столбцам «инцидент/осмотр/допуск/сдача» построен по импортам и командам; отдельные тонкости (какие именно стадии чек-листов реализованы в каждом варианте) не разбирались.
- Офлайн-очередь помечена «да» по факту импорта `useOfflineQueue`; глубина покрытия (какие команды ставятся в очередь в каждом варианте) не проверялась.
