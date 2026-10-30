# Очередь 1030 — промежуточный итог

| № | Задача | Ветка | Коммиты | Состояние |
|---|---|---|---|---|
|1|pto-review|codex/pto-review-1030|471f1a46,de84efc2|Частичная проверка, исправлен подсчёт исключённых свай; есть пробелы и решение владельца по XLSX|
|2|concurrency|codex/concurrency-1030|нет|Worktree/junction готовы, сценарии ещё не написаны|
|3|e2e-preconditions|нет|нет|Не начата|
|4|sql-budget|нет|нет|Не начата|
|5|release-gate|нет|нет|Не начата|
|6|split-600|нет|нет|Не начата|

Задача1: tsc0;lint0/0warnings;полныйvitest5866passed/285skipped,exit0;Playwright429тестов/31файл,exit0;build1(нет DATABASE_PROVIDER/SESSION_SECRET). Отдельно PostgreSQL109passed/0skipped,exit0;свои контейнеры удалены. RED2failed→GREEN12passed. Полной проверки Next/build, Excel/печати и всех числовых граф нет. Подробности в pto-review.md/json.

Main/production не менялись. Все задачи отдельно от c204d90e, push/merge/deploy не выполнялись. Продолжение D:/PillingR/night-logs/codex-1030/RESUME.md. Очередь не закончена.
