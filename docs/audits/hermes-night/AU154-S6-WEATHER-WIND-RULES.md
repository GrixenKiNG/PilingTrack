# AU154-S6-WEATHER-WIND-RULES: Погода и ветер: правила остановки работ

Аудит только чтением. Код приложения не изменялся.
Версия: `git rev-parse HEAD` = `704df50bc813e3a9cde7c883307f432e9983bd7f`
(ветка `hermes/q4-0926`).

## Итог

Источник погоды один на весь продукт: `src/services/weather/weather-client.ts`
(Open-Meteo, без ключа). Порог владельца ≥15 м/с применяется в двух местах —
карточка погоды (`src/app/api/weather/route.ts`) и правила смены
(`src/modules/operator-mobile/domain/work-warnings.ts`); оба читают «15 и выше»
через `>=`. Погода НИКОГДА не блокирует: при ≥15 м/с выдаётся красное
предупреждение уровня STOP, решение о остановке остаётся за человеком на площадке
(`production-permit.ts:20-24`). При недоступности сервиса клиент возвращает
`null`, экран показывает «Погода недоступна», авто-ответ в чек-лист не
подставляется. Найдено 7 находок: 0 критично, 2 важно, 5 мелочь.

Топ-5:
1. **важно** `known-answers.ts:51` — при РОВНО 15 м/с чек-лист ТБ авто-отвечает
   «норма», хотя та же цифра даёт красное STOP: противоречие на одном экране.
2. **важно** предупреждения STOP/ALERT не доходят до диспетчера — экран
   `operator/mobile` доступен только роли OPERATOR; в коде «диспетчер видит», в
   поведении — нет.
3. **важно** порог задан двумя константами (`WIND_STOP_WORK_MS` и `WIND_STOP_MS`)
   — рассинхрон возможен и уже реализовался находкой 1.
4. **мелочь** `getSiteWind`/`WindReading` не вызываются нигде, кроме своего теста —
   кандидат в мёртвый код (нужно решение владельца).
5. **мелочь** устаревшие комментарии про «20 м/с» и «Gismeteo» в frozen-файлах.

## Методика

Инструменты: `search_files` (ripgrep) по `src/` и `docs/` (сами отчёты
`docs/audits/**` не читались), `read_file` с диапазонами. Запросы:
`(?i)weather|погод|wind|ветер|мороз|frost|temperature|температур`,
`WIND_STOP_WORK_MS|WIND_BOOM_TRANSPORT_MS|WIND_STOP_MS|windMs|windSpeed`,
`weatherStop|collectWarnings|WIND_STOP|COLD_STOP`, `getWeatherAt|getSiteWind|readWeather|WeatherCard`,
`hasAlerts`, `Gismeteo|20 м/с`, `knownAnswers`, `id: 'wind'`.
Проверка поведения — чтение кода по строкам; живые тесты:
`node node_modules/vitest/vitest.mjs run src/services/weather src/app/api/weather src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts`
→ `Test Files 3 passed (3)`, `Tests 72 passed (72)`, exit 0.

## Карта применения: где берётся и применяется ветер/погода

Формат: место | файл:строка | поведение | тест | статус.

| Место | Файл:строка | Поведение | Тест | Статус |
| --- | --- | --- | --- | --- |
| Источник данных | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE` (default `https://api.open-meteo.com`), без ключа | — | ПРОЙДЕНО (чтение) |
| Параметры запроса | `src/services/weather/weather-client.ts:85-86` | `current=wind_speed_10m,temperature_2m,precipitation,is_day`, `wind_speed_unit=ms` | `weather-client.test.ts:32-42` | ПРОЙДЕНО |
| Таймаут/предохранитель | `src/services/weather/weather-client.ts:74,76-80,88` | timeout 3 с, CircuitBreaker (3 отказа, reset 60 с) | не покрыто | НЕ ПРОВЕРЕНО |
| Кэш | `src/services/weather/weather-client.ts:73,162-165` | Redis-кэш 15 мин, ключ `point:<lat>.<lon>` (сотые градуса) | не покрыто | НЕ ПРОВЕРЕНО |
| Недоступность сервиса | `src/services/weather/weather-client.ts:167-174` | ловит любую ошибку → `logger.warn` + `null`, НИКОГДА не бросает | `weather-client.test.ts:45-51` | ПРОЙДЕНО |
| Порог «прекращение работ» | `src/services/weather/weather-client.ts:70` (`WIND_STOP_WORK_MS=15`) | константа для карточки | — | ПРОЙДЕНО |
| Порог «стрела в транспорт» | `src/services/weather/weather-client.ts:71` (`WIND_BOOM_TRANSPORT_MS=36`) | константа для карточки | — | ПРОЙДЕНО |
| Теnancy | `src/services/weather/weather-client.ts:132-137` | `tenantId` обязателен (throw), `findFirst where {id,tenantId}` | `weather-client.test.ts:26-30` | ПРОЙДЕНО |
| Карточка погоды — допуск | `src/app/api/weather/route.ts:68` | `windWarning = windMs >= WIND_STOP_WORK_MS` (≥15) | `route.test.ts:80-98` (только 8.4) | ПРОЙДЕНО частично |
| Карточка погоды — критично | `src/app/api/weather/route.ts:69` | `windCritical = windMs >= WIND_BOOM_TRANSPORT_MS` (≥36) | не покрыто | НЕ ПРОВЕРЕНО |
| Карточка — валидация координат | `src/app/api/weather/route.ts:45-55` | пустые/отсутствующие/вне диапазона → 400 | `route.test.ts:35-78` | ПРОЙДЕНО |
| Карточка — недоступность | `src/app/api/weather/route.ts:57-63` | `null` от клиента → 503 «Погода сейчас недоступна» | не покрыто | НЕ ПРОВЕРЕНО |
| Правила смены — STOP | `src/modules/operator-mobile/domain/work-warnings.ts:102` | `windMs >= WIND_STOP_MS` (≥15) → уровень `STOP` | `operator-mobile-rules.test.ts:99-108,384-394` | ПРОЙДЕНО |
| Правила смены — мороз | `src/modules/operator-mobile/domain/work-warnings.ts:112,63` | `temperatureC < -25` → `STOP` | `operator-mobile-rules.test.ts:110-114,386-387` | ПРОЙДЕНО |
| Порог показа пункта | `src/modules/operator-mobile/domain/shift-conditions.ts:21,56` | ветер ≥8 м/с → добавляется условие `WIND` и пункт чек-листа | (косвенно) | ПРОЙДЕНО |
| Авто-ответ чек-листа | `src/components/piling/operator-mobile/safety/known-answers.ts:50-53` | `wind <= WIND_STOP_MS` (≤15) → ответ «OK» + примечание | НЕТ теста | ГИПОТЕЗА (баг, см. находку 1) |
| Экран приёма — погода | `src/components/piling/operator-mobile/screens/admission-screen.tsx:139-169` | показывает T°/ветер; нет данных → «Погода недоступна» | — | ПРОЙДЕНО (чтение) |
| Экран работы — ветер | `src/components/piling/operator-mobile/screens/work-screen.tsx:311-319` | «Ветер N м/с · <когда измерено>» / «нет данных» | — | ПРОЙДЕНО (чтение) |
| Экран обзора | `src/components/piling/operator-mobile/screens/review-screen.tsx:127-132` | T° и ветер строкой | — | ПРОЙДЕНО (чтение) |
| Панель предупреждений | `src/components/piling/operator-mobile/warnings-panel.tsx:29-62` | STOP/ALERT раскрыты, NOTE свёрнуты | `__tests__/field-readability.test.tsx` | ПРОЙДЕНО |
| Передача в состояние | `src/modules/operator-mobile/application/mobile-shift-query.ts:402-421,570` | координаты→`readWeather`→`weather`/`conditions`/warnings | — | ПРОЙДЕНО (чтение) |
| Снимок условий при открытии | `src/modules/operator-mobile/application/commands/equipment.ts:125-140` | условия снимаются один раз и пишутся в evidence | — | ПРОЙДЕНО (чтение) |
| Запись выработки | `src/modules/operator-mobile/application/commands/production.ts:163-168` | погода НЕ блокирует; `readWeather` оставлен, не используется | — | ПРОЙДЕНО (чтение) |
| Порты/маршруты | `src/app/api/operator/mobile/state/route.ts:61`; `.../command/route.ts:220,228` | `readWeather: getWeatherAt` | — | ПРОЙДЕНО (чтение) |
| Карточка (frozen, v2) | `src/components/piling/operator-v2/weather-card.tsx:60-205` | свои пороги только для отображения, данные из `/api/weather` | — | frozen — не трогать |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему это важно | Рекомендация |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/components/piling/operator-mobile/safety/known-answers.ts:51` | `if (wind !== null && wind <= WIND_STOP_MS)` включает ровно 15 м/с, хотя `work-warnings.ts:102` при 15 м/с уже выдаёт STOP. Комментарий строки 48 («выше порога ответа не подставляем») коду противоречит. | Ветер ровно 15,0 м/с (сервис отдаёт 15,0): на экране оранжевое «Критическое предупреждение · Ветер 15 м/с» И одновременно пункт «Ветер в допуске для подъёма сваи» авто-отвечен «OK» с примечанием «Подтверждено системой». Оператор видит «норма» там, где остановка. | Заменить `<=` на `< WIND_STOP_MS`; добавить тест на границу 15,0. |
| 2 | важно | `src/modules/operator-mobile/domain/work-warnings.ts:272` (`hasAlerts`, не используется); `src/app/api/operator/mobile/state/route.ts:22-24` | В коде обещано «красное видят оператор И диспетчер» (`work-warnings.ts:38`, `warnings-panel.tsx:16,23`), но `hasAlerts` не вызывается нигде, а маршрут состояния доступен только роли `OPERATOR` (иначе 403). Потребителя предупреждений у диспетчера нет. | Ветер 18 м/с на площадке: STOP-предупреждение существует только на телефоне машиниста. Диспетчер не получает ни уведомления, ни экрана — при аварийном порыве «видит диспетчер» не выполняется. | Либо подключить `hasAlerts`/STOP-погоду к экрану диспетчера, либо убрать из комментариев утверждение про диспетчера и зафиксировать это решение. |
| 3 | важно | `src/services/weather/weather-client.ts:70` и `src/modules/operator-mobile/domain/work-warnings.ts:61` | Один порог 15 хранится двумя независимыми константами (`WIND_STOP_WORK_MS`, `WIND_STOP_MS`); синхронизировать их обязан человек (комментарии `weather-client.ts:64-68`, `work-warnings.ts:56-59`). Импорт запрещён eslint no-restricted-imports. | Расхождение уже реализовалось: находка 1 — прямое следствие того, что `known-answers.ts` берёт модульную константу, но с неверным оператором, а карточка — сервисную. Правка порога в одном месте молча разведёт экраны. | Вынести число и семантику («≥15 — STOP») в один источник, доступный обоим слоям (например, константа в `src/lib` без зависимостей от modules/services). |
| 4 | мелочь | `src/services/weather/weather-client.ts:131` (`getSiteWind`), `:26-30` (`WindReading`) | `getSiteWind`/`WindReading` не вызываются нигде, кроме `weather-client.test.ts`. | Мёртвый экспорт. Удалять нельзя без доказательства и решения владельца (AGENTS §4: намерение могло быть отложенным). | Решить судьбу с владельцем; пока не трогать. |
| 5 | мелочь | `src/components/piling/operator-v2/weather-card.tsx:7`; `src/components/piling/operator-v2/operator-shift-v2.tsx:404` | Устаревшие комментарии: «Погоду всегда отдаёт Gismeteo» (фактически Open-Meteo, `route.ts:13-19`); «карточка считает опасным ветром 20 м/с, а правила — 15» (порог давно единый 15). | Вводят в заблуждение при чтении/ревью. Файлы frozen — правку только по решению владельца. | Отметить в списке для владельца; при разморозке поправить текст. |
| 6 | мелочь | `src/app/api/weather/__tests__/route.test.ts:80-98`; `src/services/weather/__tests__/weather-client.test.ts` | Нет теста границы 15 м/с на маршруте (проверяется только 8.4 → `false`), нет теста `windCritical` (≥36), нет теста ветки 503; у `getWeatherAt` (кэш/предохранитель) тестов нет вовсе; `known-answers` тестов не имеет. | Регрессия порога на карточке или авто-ответа не будет поймана. | Добавить граничные тесты (15,0 / 36,0) и тест 503; тест `knownAnswers` на 15,0. |
| 7 | мелочь | `src/services/weather/weather-client.ts:22-24` | Комментарий обещает «экран показывает поле ручного ввода», но у оператора ручного ввода ветра нет — при `null` показывается «Погода недоступна» (`admission-screen.tsx:163-166`), а ручной ответ даётся пунктом чек-листа. | Расхождение комментария и поведения. | Уточнить комментарий. |

Легенда severity: критично / важно / мелочь. Статусы: ПРОЙДЕНО — подтверждено
чтением кода/тестом; ГИПОТЕЗА — вывод из чтения без прогона; НЕ ПРОВЕРЕНО — не
выполнялось.

## Ответы на вопросы задания

- **Откуда берётся ветер/погода.** Один клиент `src/services/weather/weather-client.ts`
  (Open-Meteo, `apiBase` из `WEATHER_API_BASE`, default `api.open-meteo.com`,
  строки 82-86). Координаты — от телефона (`navigator.geolocation`) или из карточки
  объекта (`mobile-shift-query.ts:396-404`, `state/route.ts:45-52`).
- **Порог (решение владельца ≥15).** Две константы по 15: `WIND_STOP_WORK_MS`
  (`weather-client.ts:70`) и `WIND_STOP_MS` (`work-warnings.ts:61`). Обе сравнивают
  `>=` (`route.ts:68`, `work-warnings.ts:102`). Плюс 36 м/с — стрела в транспорт.
- **Где применяется (допуск / предупреждение).** Только предупреждение.
  `weatherStop` даёт уровень `STOP` (`work-warnings.ts:99-123`), оно рисуется на
  приёме/работе/обзоре оператора (`warnings-panel.tsx:43-62`). ДОПУСК погоду НЕ
  учитывает вовсе: `production-permit.ts:20-24` явно исключает погоду из запретов.
- **Что при недоступности сервиса.** Клиент возвращает `null` и пишет `logger.warn`
  (`weather-client.ts:167-174`), маршрут карточки отдаёт 503 (`route.ts:57-63`),
  экран показывает «Погода недоступна» и авто-ответ в чек-лист не подставляется
  (`known-answers.ts:50-53` — при `null` условие не проходит). Объект не
  останавливается никогда (`work-warnings.ts:95-98`, `route.ts:21-24`).

## Не проверено

- Прогон `npm run build` / `tsc --noEmit` / `npm run lint` — не выполнялись
  (read-only аудит, изменения не вносились; среда без гарантии env/БД).
- Рантайм `getWeatherAt`: кэш Redis, предохранитель, таймаут 3 с — код прочитан,
  но живьём не воспроизводился (нет тестов; внешний сервис не дёргался).
- Ветка 503 и `windCritical` (≥36) маршрута `/api/weather` — покрытия тестами нет,
  проверено только чтением.
- Поведение `known-answers.ts` на ровно 15,0 м/с — вывод из чтения кода
  (ГИПОТЕЗА): прогон не делал, точечного теста нет.
- Является ли отсутствие потребителя предупреждений у диспетчера (находка 2)
  осознанным решением, отложенной задачей или дефектом — по коду не определить.
- Существующие отчёты `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` не
  читались (запрещено заданием).
