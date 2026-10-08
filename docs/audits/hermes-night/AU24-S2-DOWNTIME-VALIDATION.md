# AU24-S2-DOWNTIME-VALIDATION: Простой — проверки ввода, пересечения интервалов, границы

Версия (git rev-parse HEAD рабочей папки): `50ca9691dbe0aea5f3ceb72b8a1f4038a80d6993`
Ветка: `hermes/q4-0926`. Только чтение; изменён только этот файл.

## Итог

Простей вошёл в стадию «часы без интервала» (решение владельца 07.10.2026): форма машиниста и мобильный API считают простой одним числом часов с шагом в четверть часа; старый интервальный путь (начало/конец) сохранён для офлайн-очереди. Проверки границ (ноль, отрицательное, дробное, максимум, сумма за смену) на сервере есть и покрыты тестами.
Главная дыра: правило шага «четверть часа» и запрет нуля живут ТОЛЬКО на мобильном экране; форма отчёта (`/report`) и админ-форма шлют часы прямо в API, а схема `reportUpsertSchema` принимает любой `float` от 0 до 24 — 1,3 ч сохраняется.
Второе: отчётная ветка (`upsertReport`) НЕ проверяет причину простоя (существование/организацию/активность) — только мобильная. Несуществующий `reasonId` проходит валидацию схемы и падает на FK (P2003), а обёртка не знает этот код → 500 + событие Sentry вместо 400.
Найдено по severity: критично — 0, важно — 3, мелочь — 4 (одна находка — ГИПОТЕЗА). Самые ценные: (1) шаг/ноль не enforced на API и в формах отчёта; (2) причина не валидируется в отчётной ветке → 500; (3) mapper не хранит `startedAt/endedAt/durationSeconds` — возможна потеря интервала при пере-сохранении отчёта (гипотеза).
Закрытые области (`src/modules/operator-mobile/**`, `src/components/piling/operator*/**`) только прочитаны как источник контекста (там живёт интервальная логика) — не менялись.

## Методика

Поиск по репозиторию (инструмент `search_files`, ripgrep): шаблоны `downtime`, `parseDowntimeHours|downtimeHoursBetween|DOWNTIME_MAX_HOURS|DOWNTIME_STEP_HOURS|downtimeHoursProblem`, `ReportDowntime|downtimeReason`, `addDowntime|report-validation|ReportAggregate`, `requireDowntimeReason`, `overlap|пересек`.
Прочитаны целиком (файл:строка подтверждены открытием): `src/lib/downtime-hours.ts`, `src/components/piling/report-form/downtime-section.tsx`, `src/components/piling/report-form/use-report-form.ts` (строки 370–491), `src/components/piling/report-form/report-form.tsx` (30–89), `src/components/piling/admin-reports/report-form-dialog.tsx` (150–219, 390–414), `src/lib/validation-schemas.ts` (240–292, 409–466), `src/modules/reports/domain/report.aggregate.ts`, `src/modules/reports/application/commands/report-validation.service.ts`, `src/modules/reports/application/commands/report-command.service.ts`, `src/modules/reports/infrastructure/report.prisma.mapper.ts`, `src/app/api/reports/upsert/route.ts`, `src/app/api/reports/admin-upsert/route.ts`, `src/core/api-wrapper.ts` (25–146), `prisma/schema.prisma` (2388–2433), `src/modules/operator-mobile/domain/downtime-interval.ts`, `src/modules/operator-mobile/application/commands/production.ts` (380–509), `src/modules/operator-mobile/application/commands/shared.ts` (126–154).
Тесты прочитаны: `src/lib/__tests__/downtime-hours.test.ts`, `src/lib/__tests__/downtime-hours-input.test.ts`, `src/modules/reports/application/commands/__tests__/report-validation.test.ts`, `src/modules/reports/domain/__tests__/report-aggregate.test.ts` (55–226), `src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts` (500–579), `src/app/api/operator/mobile/command/__tests__/downtime-hours.test.ts`.

Команды (только чтение):
```
git rev-parse HEAD            # 50ca9691dbe0aea5f3ceb72b8a1f4038a80d6993
git status --short            # M AGENTS.md (предсуществующее, не трогал)
git branch --show-current     # hermes/q4-0926
git log --oneline -3          # 50ca9691 / 7a560990 / 6a3625ce
node -e "console.log(require('fs').readFileSync('src/lib/downtime-hours.ts','utf8').split('\n').length)"   # 130
```

## Таблица проверок ввода (статус ПРОЙДЕНО / ГИПОТЕЗА / НЕ ПРОВЕРЕНО)

| Проверка | Где (файл:строка) | Что происходит при нарушении | Тест (файл:строка) |
|---|---|---|---|
| Ноль часов | схема `validation-schemas.ts:280` (`min(0)`), агрегат `report.aggregate.ts:225` (`< 0`) — ПРОПУСКАЕТ; формы отклоняют: `use-report-form.ts:377`, `report-form-dialog.tsx:156` | API: 0 сохраняется как валидный. Формы: тост «Заполните причину и длительность» | нет прямого теста на 0 в отчётной ветке (мобильная: `downtime-hours.test.ts:77` — 0 → 400) |
| Отрицательное | схема `validation-schemas.ts:280` (`min(0)`) → 400; агрегат `report.aggregate.ts:225`; служба `report-validation.service.ts:94` | 400 «Некорректные данные» (схема) / «Простой не может быть отрицательным» (агрегат) | `report-validation.test.ts:145`, `report-aggregate.test.ts:69` |
| Дробное (не кратно 0,25) | мобильная: `production.ts:421` (`isWholeDowntimeStep`) → 400. Отчётная ветка: НЕ проверяется (`validation-schemas.ts:280` — любой float) | Отчёт/админ-форма: 1,3 ч сохраняется | мобильная `downtime-hours-input.test.ts:15` ('1,3'); отчётная ветка — теста нет |
| Дробное (0,25/0,5/0,75…) | `parseDowntimeHours` `downtime-hours.ts:65`; мобильная `production.ts:421` | Принимается (мобильный экран) | `downtime-hours-input.test.ts:9`, `:22` |
| Минимум (< 0,25) | `downtime-hours.ts:69` (мобильная форма); отчётная схема допускает ≥0 | Мобильная: подсказка «от 0,25 до 24» / 400. Отчёт: принимается | `downtime-hours-input.test.ts:16` ('0,1'), `:38` |
| Максимум (> 24 ч) | схема `validation-schemas.ts:280`; агрегат `report.aggregate.ts:226`; служба `report-validation.service.ts:97`; мобильная `production.ts:418,458` | 400 «Длительность простоя не может превышать 24 часа» / «Простой не может превышать 24 ч» | `report-validation.test.ts:151`, `report-aggregate.test.ts:76`, `downtime-hours-input.test.ts:16` ('25','24,25') |
| Больше суток в интервале (расчёт не режет) | `downtime-hours.ts:102` (сложение суток при конце раньше начала); тест `downtime-hours.test.ts:51` | Расчёт возвращает 26 ч — режет только валидация | `downtime-hours.test.ts:51` |
| Сумма простоев за смену | агрегат `report.aggregate.ts:228-236`; служба `report-validation.service.ts:11-33` (вызов `:120`) | 400 «Суммарный простой (N ч) превышает продолжительность смены (M ч)» | `report-aggregate.test.ts:171`, `report-validation.test.ts:166,180,199` |
| Смена без времени (shiftStart/End пустые) | `report-validation.service.ts:16` (return), `report.aggregate.ts:376` (return null) | Проверка суммы пропускается | `report-validation.test.ts:187,193` |
| Простой через полночь (интервал) | `downtime-hours.ts:105` (`+86_400_000`); конфликт по реальному концу `downtime-interval.ts:23-25` | Нормализуется, не ошибка | `downtime-hours.test.ts:28,34`; `operator-mobile-rules.test.ts:551` |
| Пересечение интервалов | только мобильная ветка: `downtime-interval.ts:35-51`, вызов `production.ts:493`; вставка `:498` | 400 «Простой пересекается с уже записанным (HH:MM–HH:MM)» | `operator-mobile-rules.test.ts:534,539` |
| Простой в закрытой смене | мобильная: `production.ts:123` (`requireOpenShift`) → отказ. Отчётная: блок только для STARTED/HANDOVER_PENDING — `report-command.service.ts:199` | Мобильная: отказ. Отчёт по закрытой смене правится в окне 24 ч (по замыслу) | `operator-mobile-rules.test.ts:571,576` |
| Причина обязательна | схема `validation-schemas.ts:274` (`reasonId: internalIdSchema` — обязательная) | 400 «Некорректные данные» при отсутствии | нет отдельного теста |
| Причина существует / той же организации / активна | мобильная: `shared.ts:150-154` (`isActive: true`, `tenantId`). Отчётная ветка: НЕ проверяется | Отчёт: несуществующий id → FK P2003 → 500; чужой/архивной причине ничего не мешает | мобильная `production.test.ts` (мок findFirst); отчётная ветка — теста нет |
| Комментарий не длиннее 1000 | `validation-schemas.ts:281` (`max(1000)`); форма `report-form-dialog.tsx:406` (`maxLength={1000}`) | 400 при превышении через API | нет отдельного теста |
| Дата отчёта не в будущем | `report-validation.service.ts:35-42`, вызов `:116` | 400 «Дата отчёта не может быть в будущем» | `report-validation.test.ts:56-77` |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/lib/validation-schemas.ts:280`; `src/modules/reports/domain/report.aggregate.ts:222-236`; `src/components/piling/report-form/use-report-form.ts:377`; `src/components/piling/admin-reports/report-form-dialog.tsx:156-164` | Правило шага «четверть часа» (`DOWNTIME_STEP_HOURS`, `downtime-hours.ts:53`) и запрет нуля enforced только на мобильном экране (`production.ts:415-423`). Отчётная схема принимает любой float 0…24. | Оператор в форме `/report` или админ в диалоге вводит 1,3 ч (браузерный `step` не блокирует JS-чтение значения) — простой сохраняется не кратно четверти, чего решение владельца 07.10.2026 не допускает. Цифры простоя перестают быть сопоставимы между экранами. | В `reportUpsertSchema` (и админской) заменить `z.number().min(0).max(24)` на проверку `isWholeDowntimeStep` + нижнюю границу `DOWNTIME_STEP_HOURS`; в формах использовать `parseDowntimeHours`/`downtimeHoursProblem` как на мобильном. |
| 2 | важно | `src/modules/reports/application/commands/report-command.service.ts:395-396`; `src/lib/validation-schemas.ts:274,16`; `src/core/api-wrapper.ts:26-29,127-133`; `prisma/schema.prisma:2423` | Отчётная ветка не валидирует причину: `reasonId` — просто `z.string().min(1).max(64)` (`internalIdSchema`), агрегат причину не смотрит, `requireDowntimeReason` (`shared.ts:150`) вызывается только в `operator-mobile`. | Прямой POST в `/api/reports/upsert` с несуществующим `reasonId` проходит safeParse, падает на FK (onDelete Restrict) как P2003; `PRISMA_STATUS` не содержит P2003 → ветка `else` → 500 «Внутренняя ошибка сервера» + событие Sentry на пользовательскую опечатку. Чужой (другой организации) `reasonId` FK пропускает и сохраняет. | В `upsertReport` перед `applyEntriesToAggregate` резолвить каждую причину по `{ tenantId, id }` (для новых строк — ещё `isActive`), как делает `requireDowntimeReason`; вернуть 400 с понятным текстом. |
| 3 | мелочь | `src/components/piling/report-form/downtime-section.tsx:60` | Поле формы отчёта: `type="number" step="1" min="1"` — допускает только целые часы ≥ 1. | Форма отчёта не даёт ввести 0,25/0,5/0,75/1,5 ч, хотя правило разрешает от 0,25 (и мобильный экран это умеет). Разные экраны диктуют разные единицы. | `min={DOWNTIME_STEP_HOURS}` `step={DOWNTIME_STEP_HOURS}` и подсказка `downtimeHoursProblem`. |
| 4 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:402-403` | Админ-форма: `step="0.5" min="0.5"` — не совпадает ни с четвертью часа, ни с целыми часами формы отчёта; шаг не enforced в JS. | Три экрана ввода простоя задают три разных шага (1 / 0.5 / 0.25). | Привести к единому `DOWNTIME_STEP_HOURS`. |
| 5 | мелочь | `src/lib/validation-schemas.ts:275-280` | Комментарий противоречит коду: «Простой измеряется полными часами: неполный округляется вверх» — при `min(0).max(24)` без округления и строке-пояснении ниже «Без округления». | Вводит в заблуждение при следующей правке: легко вернуть округление, от которого отказались 19.09.2026 (`downtime-hours.ts:1-12`). | Обновить комментарий: единица хранения — час, шаг ввода — четверть, без округления. |
| 6 | мелочь | `src/lib/validation-schemas.ts:280`; `src/modules/reports/domain/report.aggregate.ts:225` | Ноль часов: схема и агрегат допускают (`min(0)`, `< 0`), обе формы отклоняют. | Правило и UI расходятся: либо 0 законен («простоя не было» — комментарий `validation-schemas.ts:278`), и тогда формы зря блокируют, либо нет — и тогда схему надо ужесточить. Сейчас поведение зависит от того, через форму отправили или напрямую. | Зафиксировать решение владельца и согласовать нижнюю границу во всех трёх местах. |
| 7 | важно (ГИПОТЕЗА) | `src/modules/reports/infrastructure/report.prisma.mapper.ts:49-55`; `prisma/schema.prisma:2403-2405` | Mapper отчётной ветки пишет только `reasonId/duration/comment`; `startedAt/endedAt/durationSeconds` (заполняются интервальной веткой `production.ts:426-440`, `442+`) не читаются и не пишутся. | ГИПОТЕЗА (не воспроизводил на стенде): отчёт, созданный мобильным интервальным путём, при сохранении через `upsertReport` (форма/админ) пересобирается из `input.downtimes` (только `duration`) — интервальные колонки обнуляются, а проверка пересечения `findDowntimeConflict` читает именно `startedAt/endedAt` (`production.ts:485-491`). Возможна частичная потеря данных интервала и ослабление защиты от двойного счёта часов. | НЕ ПРОВЕРЕНО на реальных данных. Требуется проверить, пишет ли интервальная ветка в отчёт, который затем правится формой; при подтверждении — сохранять интервал или переносить длительность осознанно. |

## Пропущенные проверки (отдельно)

1. Шаг четверти часа на сервере для отчётной ветки — отсутствует (см. находку 1).
2. Существование/организация/активность причины простоя в `upsertReport` — отсутствует (см. находку 2); `requireDowntimeReason` есть, но только в `operator-mobile`.
3. Запрет нуля согласованно — расходится между схемой/агрегатом и формами (см. находку 6).
4. Проверка пересечения интервалов в отчётной ветке неприменима, т.к. там нет интервалов; но интервальные колонки БД отчётной веткой не поддержаны (см. находку 7).
5. Нет теста «нулевая длительность в отчётной ветке» и «причина чужой организации» — прямое следствие пробелов 2–3.

## Что не проверено

- НЕ ПРОВЕРЕНО на реальных данных: поведение интервальных колонок `startedAt/endedAt/durationSeconds` при пере-сохранении отчёта через форму/админ (находка 7) — только чтение кода, стенд не поднимал, БД не подключал (правило задачи: только чтение).
- НЕ ПРОВЕРЕНО запуском: тесты не прогонял (задача read-only, проверка кода). Числа «пройдено/пропущено» не привожу — команд тестов не запускал.
- НЕ ПРОВЕРЕНО: точный HTTP-код ответа при FK-нарушении в бою (P2003 → 500) выведён из чтения `api-wrapper.ts:26-29,119-133`; эмпирически не воспроизводил.
- Замороженные области (`src/modules/operator-mobile/**`, `src/components/piling/operator*/**`, ORION) прочитаны как контекст (там интервальная логика), но не оценивались как объект правок.
- Не проверял `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` — независимость первого прохода по условию задачи.
