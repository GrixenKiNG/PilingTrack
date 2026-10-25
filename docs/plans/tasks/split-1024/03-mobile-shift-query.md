# Задание 3 из 4: `mobile-shift-query.ts` (780 строк)

Сначала прочитать `00-common.md`. Ветка: `codex/split-mobile-shift-query`. Не начинать, пока задания 1 и 2 не приняты.

## Явное снятие запрета заморозки (только здесь)

`AGENTS.md` §1 запрещает трогать `src/modules/operator-mobile/**`. **Для этого задания разрешено** менять один файл — `src/modules/operator-mobile/application/mobile-shift-query.ts` — и создавать новые файлы рядом в `src/modules/operator-mobile/application/`. Больше ничего в `operator-mobile` не менять: ни `commands/**`, ни `index.ts`, ни тест `mobile-shift-query.test.ts` (его только запускать). Функция `queryOperatorMobileState` продолжает экспортироваться из того же файла (её импортируют `index.ts` и тест).

## Что в файле

| Строки | Содержимое | Куда |
|---|---|---|
| 37–137 | `DAY_MS`, `todayInTimezone`, `DOWNTIME_ONLY`, `ReportRows`, `buildEntries` | `mobile-shift-entries.ts` |
| 138–720 | `queryOperatorMobileState` — одна функция ~580 строк: последовательные стадии чтения БД | **остаётся** |
| 721–конец | `round1`, `sitePileVolume`, `loadDictionaries` | `mobile-shift-loaders.ts` |

## Порядок шагов

1. Базовая линия + `npx vitest run src/modules/operator-mobile` (все тесты каталога) — записать passed/skipped/failed.
2. Перенос 37–137 → `mobile-shift-entries.ts`. Внимание: `round1`, если используется и в `buildEntries`, и в основной функции, переносится в **один** файл и импортируется из другого — без дублирования и без циклов. Если цикл неизбежен, остановиться и написать в отчёт.
3. Перенос 721–конец → `mobile-shift-loaders.ts`.
4. Финальные проверки; `check-pure-move.cjs` с кодом 0.

## Что не делать

- **Не резать `queryOperatorMobileState`.** Порядок и состав запросов (`Promise.all` на 159, чтение `ppeCheck`, `sitePilePlan`, транзакции чтения) определяют результат и нагрузку на базу; перенос по стадиям потребовал бы передавать десятки значений. Ожидаемый итог — файл около 520–600 строк, цель «≤ 500» не обязательна.
- Не менять `select`/`where`, не заменять `db` на другой клиент, не трогать tenantId-условия (организация в каждом запросе — обязательное правило безопасности проекта). Перенесённые функции берут `tenantId` теми же параметрами, что раньше.
- Не писать `console.log`; логирование не добавлять.

## Готово, когда

Критерии `00-common.md`; тесты каталога `src/modules/operator-mobile` — те же числа, что в базовой линии; `queryOperatorMobileState` экспортируется тем же именем из того же пути.
