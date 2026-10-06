# Журнал забивки свай — источник, итоги, выгрузка

> Обновлено: 2026-10-07. Отражает состояние после W14 (`965df4a4`), W21 (`59384c2d`), W30 (`5baf2fff`).
> Экран — вкладка «Журнал забивки» на `/admin/reports?view=piles`; код — `src/components/piling/pile-journal/**`.

## Источник данных

- Строка журнала — запись выработки `PileWork` (одна строка = одна запись): марка, количество, смена, объект, автор, дата. Паспорт подключается к строке по `pileWorkId` (`src/modules/reports/application/queries/pile-passport.service.ts:309`, `:329-332`).
- Свая без паспорта (записана «пачкой», `PileWork.count > 1`) всё равно попадает в журнал — с пометкой «без паспорта» (`pile-passport.service.ts:717`; экран `src/components/piling/pile-journal/index.tsx:416-420`). Замеров и решения у такой строки нет.
- Строка из отчёта-черновика помечается «черновик» (`pile-passport.service.ts:718`; экран `index.tsx:421-425`).
- Данные отдаёт `GET /api/pile-passports` → `listPilePassports`; право — `piles.manage` (`src/app/api/pile-passports/route.ts:34,49`).

## Итоги периода

- Титул («Свай всего», «без паспорта», «принято/на добивку/не разобрано») считается **по всему периоду** отдельным агрегатом, а не по показанной странице (`pile-passport.service.ts:268-313`, `:377-379`; W21).
- Единицы не смешаны: «Свай …» — сумма `count`, «Паспортов …» — число строк с паспортом (`pile-passport.service.ts:263-267`).
- Период по дате забивки считается по поясу тенанта, не по UTC (`pile-passport.service.ts:202-222`).

## Экран и выгрузка

- Экран — до 500 строк (`PILE_JOURNAL_LIMIT = 500`, `pile-passport.service.ts:165`); при срезе показывается «Показано N из M записей» (`index.tsx:315-319`).
- Выгрузка `.xlsx` — до 20000 строк (`PILE_JOURNAL_EXPORT_LIMIT = 20000`, `pile-passport.service.ts:175`; `exportPileJournalXlsx` `:645-657`; W21). При срезе в файл добавляется строка-предупреждение (`:692`). Выгрузка не ограничена периодом 92 дня.
- Выгрузка ограничена частотой: 6 в минуту на пользователя, ключ `pile-export:get:<userId>` (`src/app/api/pile-passports/export/route.ts:26-30`, `:51`; W30).

## Приёмка

- Решение принимает мастер и только у строки, у которой есть паспорт: `POST /api/pile-passports/[id]/decide` работает с `passportId` (`src/app/api/pile-passports/[id]/decide/route.ts:41,58`); на экране клик по строке без паспорта не даёт решать (`index.tsx:168,432-444`).
- Допустимые решения — `ACCEPTED` и `NEEDS_REDRIVE`; для добивки обязательна причина (`[id]/decide/route.ts:13-20`; проверка причины — `pile-passport.service.ts:599-601`).
