# W83 — Битые ссылки в runbook и отчётах аудита

## Итог

- Проверено 823 относительные ссылки на `.md`-файлы (обратные кавычки) и все markdown-ссылки `[text](путь)` в `docs/runbooks/` (17 файлов) и `docs/audits/` (227 файлов).
- Относительных markdown-ссылок `[text](путь)` на файлы docs **нет вообще** — все перекрёстные ссылки между аудит-документами и ранбуками записаны в обратных кавычках как пути/имена файлов.
- Битых: **31** (критично 0, важно 12, мелочь 19). Из них 14 указывают на файлы в `docs/` (или должны указывать), остальные 17 — на внешние артефакты (`D:/PillingR/codex-night/...`, прогоны QA, документация Alertmanager/vitest из context7).
- Ни в одном ранбуке битых ссылок на файлы `docs/` нет; все находки — в `docs/audits/`.
- Топ-5:
  1. `docs/audits/hermes-night/R121-forms-validation.md:31` и `R133-session-expiry-ux.md:73` — ссылка на несуществующий `R41-user-facing-errors.md`; реальный файл — `41-user-facing-errors.md` (без буквы R).
  2. Ранбуки цитируются по короткому имени без пути (`010-restore-drill.md`, `011-app-db-role.md`, `012-rls-fail-closed.md`, `013-prod-timers.md`, `014-post-deploy-2026-10.md`) — как путь не разрешаются.
  3. `docs/audits/hermes-night/W74-OWNER-CHANGELOG-1007.md:178` — ссылка на `docs/runbooks/017-pile-journal-indexes.md`, которого нет в этой ветке (файл есть только на `main`).
  4. `W3-EQUIP-CARD-ZERO.md:13,19` — `STRATEGY-2026Q4.md` без пути (реально `docs/strategy/STRATEGY-2026Q4.md`).
  5. `W24-ADR-0043-OPTIONS.md:47` — `0043-audit-hash-chain.md:13` без пути (реально `docs/adr/0043-audit-hash-chain.md`).

## Методика

Что искали и как проверить повторно:

1. Область: только `docs/runbooks/` и `docs/audits/` (по тексту задачи). Файлов: 17 + 227.
2. Скрипт на Node (Python в окружении нет) обходил каждый `.md`, извлекал регулярками:
   - markdown-ссылки `!?\[([^\]]*)\]\(([^)\s]+)\)`;
   - содержимое обратных кавычек `` `...` ``.
3. Отбрасывались: URL (`http/https/mailto/ftp`), якоря (`#...`), regex/глобы (символы `{ } * | < >`), пробелы; для основного списка оставлены только токены, оканчивающиеся на `.md` (после снятия хвоста `:12` / `:12-15`). Прозаический артефакт `` `.md` `` исключён.
4. Для каждого кандидата проверено существование файла: (а) относительно каталога документа, (б) относительно корня репозитория. Дополнительно искали «похожий файл» по базовому имени по всему репозиторию (кроме `.git`, `node_modules`, `.next`).
5. Абсолютные пути (`D:\...`, `D:/...`, `C:\...`, `/...`) не считаются относительными ссылками; они вынесены в приложение и по существу не проверялись.
6. Существование файла подтверждено `ls`/`git` (см. ниже построчно), а не только скриптом.

Перезапуск: скрипт-сканер лежал во временном каталоге сессии (не в репозитории); логика воспроизводится тремя шагами выше. Проверка конкретного пути — `ls <путь>` из корня репозитория.

## Находки

Все находки — «файл не существует по указанному пути». Столбец «похожий файл» заполнен только когда он реально найден в дереве.

| # | severity | файл документа:строка | ссылка | существует | похожий существующий файл | почему важно / сценарий |
|---|---|---|---|---|---|---|
| 1 | важно | docs/audits/hermes-night/R121-forms-validation.md:31 | `R41-user-facing-errors.md` | нет | docs/audits/hermes-night/41-user-facing-errors.md | В отчётах серии R файлы нумеруются `R105-…`, но ранний файл называется `41-…` (без R). Ссылка на «сверку с прошлым» не открывается — читатель не найдёт источник. |
| 2 | важно | docs/audits/hermes-night/R133-session-expiry-ux.md:73 | `R41-user-facing-errors.md` | нет | docs/audits/hermes-night/41-user-facing-errors.md | То же: ссылка в списке зависимости отчётов не разрешается. |
| 3 | важно | docs/audits/hermes-night/R66-media-backup-state.md:108 | `010-restore-drill.md` | нет | docs/runbooks/010-restore-drill.md | Рекомендация «добавить в ранбук» дана коротким именем без `docs/runbooks/` — как путь не открывается. |
| 4 | важно | docs/audits/hermes-night/R68-worker-db-role.md:68 | `011-app-db-role.md` | нет | docs/runbooks/011-app-db-role.md | Перечень «полностью прочитанных ранбуков» — короткие имена, не разрешаются как пути. |
| 5 | важно | docs/audits/hermes-night/R68-worker-db-role.md:68 | `012-rls-fail-closed.md` | нет | docs/runbooks/012-rls-fail-closed.md | То же. |
| 6 | важно | docs/audits/hermes-night/R68-worker-db-role.md:69 | `013-prod-timers.md` | нет | docs/runbooks/013-prod-timers.md | То же (перенос строки разрывает имя от префикса пути). |
| 7 | важно | docs/audits/hermes-night/R83-merge-readiness.md:15 | `014-post-deploy-2026-10.md` | нет | docs/runbooks/014-post-deploy-2026-10.md | «Ручные шаги описаны в ранбуке» — имя без пути. |
| 8 | важно | docs/audits/hermes-night/R88-merge-readiness-2.md:25 | `014-post-deploy-2026-10.md` | нет | docs/runbooks/014-post-deploy-2026-10.md | То же. |
| 9 | важно | docs/audits/hermes-night/W24-ADR-0043-OPTIONS.md:47 | `0043-audit-hash-chain.md:13` | нет | docs/adr/0043-audit-hash-chain.md | Ссылка на пункт ADR дана коротким именем + номер строки; ни то, ни другое не разрешается. |
| 10 | важно | docs/audits/hermes-night/W3-EQUIP-CARD-ZERO.md:13 | `STRATEGY-2026Q4.md` | нет | docs/strategy/STRATEGY-2026Q4.md | Утверждение об устаревшей подсказке ссылается на файл без `docs/strategy/`. |
| 11 | важно | docs/audits/hermes-night/W3-EQUIP-CARD-ZERO.md:19 | `STRATEGY-2026Q4.md:26,64` | нет | docs/strategy/STRATEGY-2026Q4.md | То же, ещё и с номерами строк. |
| 12 | важно | docs/audits/hermes-night/W74-OWNER-CHANGELOG-1007.md:178 | `docs/runbooks/017-pile-journal-indexes.md` | нет (в ветке hermes/q4-0926) | есть на `main` (коммит `1ac24e79`, ветки main/codex/*) | Путь абсолютно корректный, но файла нет в текущем дереве: коммит `1ac24e79` (CODEX-J8) только на `main`, ветка `hermes/q4-0926` отстаёт на 11 и впереди на 16. Ссылка битая именно в этой ветке; после слияния с main может стать валидной. |
| 13 | мелочь | docs/audits/hermes-night/04-ui-texts.md:31 | `references/terms.md` | нет от каталога аудита | .claude/skills/domain-glossary/references/terms.md | Сокращённая ссылка на файл навыка; в строке рядом дан и полный путь к `SKILL.md`. Читается по контексту, но как путь не открывается. |
| 14 | мелочь | docs/audits/hermes-night/R131-tooltips-help.md:41 | `references/terms.md` | нет от каталога аудита | .claude/skills/domain-glossary/references/terms.md | То же. |
| 15 | мелочь | docs/audits/codex-api-audit-2026-09.md:15 | `security_best_practices_report.md` | нет | — (в репозитории отсутствует) | Отчёт перечисляет «уже существовавшие изменения», включая этот файл; файла в дереве нет (проверено `find`). Историческая ссылка на внешний/удалённый артефакт. |
| 16 | мелочь | docs/audits/hermes-night/R69-alerts-delivery.md:30 | `docs/configuration.md` | нет | — (внешняя документация Alertmanager) | Это путь в документации Alertmanager, полученной через context7 (`/prometheus/alertmanager`), а не файл репозитория. Не дефект репозитория, но визуально похоже на путь `docs/`. |
| 17 | мелочь | docs/audits/hermes-night/R69-alerts-delivery.md:30 | `docs/high_availability.md` | нет | — (внешняя документация Alertmanager) | То же. |
| 18 | мелочь | docs/audits/hermes-night/R77-heavy-static-imports.md:27 | `vi.md` | нет | — (документация vitest через context7) | Внешний справочник vitest, не файл репозитория. |
| 19 | мелочь | docs/audits/hermes-night/W1-ROLE-ROUTES.md:69 | `qa/runs/FULL-20261006-1211/report.md:100,117,123` | нет | — (внешний артефакт прогона QA) | Ссылка на прогон `D:/PillingR/qa/...`, которого в репозитории нет. Существование на диске не проверялось. |
| 20 | мелочь | docs/audits/hermes-night/W2-PILE-JOURNAL.md:5 | `tasks.md` | нет | — (внешний артефакт `D:/PillingR/qa/runs/...`) | Источник находки — файлы прогона QA вне репозитория. |
| 21 | мелочь | docs/audits/hermes-night/W35-PROJECTION-READERS.md:24 | `CODEX-THREAD-10.md:18` | нет | — (внешний файл `D:/PillingR/codex-night/`) | Задания Codex лежат вне репозитория; короткое имя, путь указан в начале документа. |
| 22 | мелочь | docs/audits/hermes-night/W4-AUDITLOG-STOPPED.md:35 | `tasks.md:95` | нет | — (внешний артефакт прогона QA) | Ссылка на внешний `tasks.md`. |
| 23 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:54 | `CODEX-THREAD-7.md` | нет | — (внешний `D:/PillingR/codex-night/CODEX-THREAD-7.md`) | Внешний файл; в документе (стр. 4) путь задан как `D:/PillingR/codex-night/CODEX-THREAD-{2..10}.md`. |
| 24 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:169 | `CODEX-THREAD-9.md` | нет | — (внешний) | То же. |
| 25 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:211 | `CODEX-THREAD-8.md` | нет | — (внешний) | То же. |
| 26 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:227 | `CODEX-THREAD-8.md` | нет | — (внешний) | То же. |
| 27 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:227 | `CODEX-THREAD-7.md` | нет | — (внешний) | То же. |
| 28 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:240 | `CODEX-THREAD-8.md` | нет | — (внешний) | То же. |
| 29 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:240 | `CODEX-THREAD-7.md` | нет | — (внешний) | То же. |
| 30 | мелочь | docs/audits/hermes-night/W54-CODEX-PLAN.md:252 | `CODEX-THREAD-9.md` | нет | — (внешний) | То же. |
| 31 | мелочь | docs/audits/hermes-night/W6-NOTIF-BADGES.md:53 | `report.md` | нет | docs/operator-next/REPORT.md, docs/qa-autoclaw/REPORT.md (однофамильцы, не тот файл) | Упомянут артефакт обхода (`report.md`) без пути — намеренно обозначает внешний отчёт прогона, не файл docs. |

### Приложение A — абсолютные ссылки на `.md` (вне области «относительных ссылок docs», не проверялись на существование на диске)

Формат `файл:строка ссылка`:

```
docs/audits/hermes-night/R74-operator-versions-map.md:59 D:/PillingR/qa/owner-decisions.md
docs/audits/hermes-night/R74-operator-versions-map.md:176 D:/PillingR/qa/OWNER-DECISIONS.md:6
docs/audits/hermes-night/README.md:37 D:/PillingR/codex-night/CODEX-THREAD-10.md
docs/audits/hermes-night/README.md:37 D:/PillingR/codex-night/CODEX-THREAD-9.md
docs/audits/hermes-night/README.md:93 D:/PillingR/codex-night/CODEX-THREAD-10.md
docs/audits/hermes-night/README.md:100 D:/PillingR/codex-night/CODEX-THREAD-9.md
docs/audits/hermes-night/W2-PILE-JOURNAL.md:5 D:/PillingR/qa/runs/FULL-20261006-1211/report.md
docs/audits/hermes-night/W2-PILE-JOURNAL.md:5 D:/PillingR/wt-autoclaw/docs/qa-autoclaw/WALK-1006.md:28,44,54
docs/audits/hermes-night/W28-CODEX-J-TESTPLAN.md:4 D:/PillingR/codex-night/CODEX-THREAD-10.md
docs/audits/hermes-night/W28-CODEX-J-TESTPLAN.md:39 D:/PillingR/codex-night/CODEX-THREAD-10.md
docs/audits/hermes-night/W3-EQUIP-CARD-ZERO.md:5 D:/PillingR/qa/runs/FULL-20261006-1211/report.md
docs/audits/hermes-night/W3-EQUIP-CARD-ZERO.md:5 D:/PillingR/wt-autoclaw/docs/qa-autoclaw/WALK-1006.md:29,45,55
docs/audits/hermes-night/W35-PROJECTION-READERS.md:24 D:/PillingR/codex-night/CODEX-THREAD-10.md:18
docs/audits/hermes-night/W54-CODEX-PLAN.md:172 D:/PillingR/codex-night/CODEX-THREAD-9.md
```

## Не проверено

- Существование внешних целей не проверялось: пути `D:/PillingR/codex-night/*`, `D:/PillingR/qa/*`, `D:/PillingR/wt-autoclaw/*` лежат вне рабочей копии `D:\PillingR\wt-night`, поэтому «файл существует (нет)» для позиций 19–31 означает «нет по относительному пути от `docs/`», а не «файла нет на диске». Почему: инструкция задачи — только чтение внутри репозитория; проверка чужих рабочих каталогов не входила в объём.
- Позиции 16–18 (`docs/configuration.md`, `docs/high_availability.md`, `vi.md`) — это пути внутри внешней документации, полученной через context7; я не открывал саму выдачу context7 и не подтверждал, что эти пути относятся к alertmanager/vitest, только по контексту строки (формулировка «сверена по документации через context7»). Классифицировано как «мелочь/внешнее» на основании текста, не по содержимому внешней документации.
- Ссылки на не-`.md` файлы в docs (картинки `.png`, `.html`) в runbooks/audits практически отсутствуют: из markdown-ссылок на файлы найдено 2, обе абсолютные и указывали на существующий `D:/PillingR/my-project/output/...` (вне репозитория). Проверка целостности бинарных ассетов docs не выполнялась.
- Markdown-ссылки вида `[text](путь)` внутри **frozen-зон** (ORION, варианты операторского экрана) не искались — они вне `docs/runbooks` и `docs/audits` и вне области задачи.
- Проверялся только `.md`-слой. Пары «runbook ↔ аудит» могут ссылаться и на код (`src/...:line`); такие ссылки в объём не входили.
