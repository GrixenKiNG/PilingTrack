# I11 — ёмкость и сроки хранения: безопасный первый шаг

Дата: 02.10.2026. Родитель: [STRATEGY-2026Q4.md](STRATEGY-2026Q4.md), инициатива I11. Подготовлены локальный инструмент инвентаризации и расчётный лист. **Политика хранения не принята, очистка не реализована, I11 целиком не завершена.**

## Что подтверждено исходниками

| Класс | Место и жизненный цикл | Доказательство |
|---|---|---|
| Временный результат задания PDF | `pdf-results/{jobId}.pdf` в S3 либо `cwd/storage/pdf-results/{jobId}.pdf` локально. Backend зависит от конфигурации; действующий production backend здесь неизвестен. | `src/lib/pdf-generator/storage.ts:9–28,32–55` |
| Метаданные PDF job | `removeOnComplete` имеет age 3600 секунд и count 1000; `removeOnFail` — age 86400 секунд и count 5000. Эти параметры BullMQ не удаляют PDF-файлы. Download требует существующее completed job. | `src/lib/pdf-queue.ts:30,96–97,232–244` |
| Удаление результата PDF | `deletePdfResult` определена и реэкспортирована; поиск по src/tests/e2e/scripts не нашёл вызывающий её рабочий код. Это не доказывает отсутствие внешнего S3 lifecycle. | `src/lib/pdf-generator/storage.ts:58–74`, `src/lib/pdf-generator/index.ts:17` |
| Фото, сканы и evidence | Ключи `media/{tenant}/{entityType}/{entityId}/…`, миниатюры и ссылки из DB. Это самостоятельные данные; DB dump не восстанавливает их содержимое. | `src/core/media/media-content.ts:161–175`; `docs/runbooks/010-restore-drill.md:187–190` |
| Иные PDF отчётов | `reportPdfKey` формирует tenant/site/year/month/report.pdf, вне временного префикса. Наличие `.pdf` не делает объект временным. Повторная генерация не гарантирует идентичности исторических байтов/оформления. | `src/core/storage/s3-service.ts:146–152` |
| Media retention | `runRetention(90)` обрабатывает soft-deleted Media по deletedAt, до 100 записей за проход. Это метод, не утверждение о запущенном расписании или одобренном владельцем сроке. Не применять его к PDF inventory. | `src/core/media/media-service.ts:439–455` |

App и workers не имеют общего storage volume в исходниках compose: `docker-compose.yml:60,155,288,356,414`; `docker-compose.prod.yml:23,42,73`. MinIO использует `minio_data:/data` (`docker-compose.yml:414–415`), другой способ хранения. Разрешение mkdir `/app/storage` в `Dockerfile.workers:80–82` не обеспечивает общий/persistent mount. При локальном fallback разные контейнеры имеют разные файловые системы. Compose и инфраструктура в этой инициативе не меняются; реально применённую конфигурацию должен подтвердить владелец.

## Инвентаризация без удаления

Инструмент: [pdf-storage-inventory.cjs](../../scripts/pdf-storage-inventory.cjs). Он требует ровно `--root` с явно указанной абсолютной локальной директорией, basename которой — `pdf-results`. Нет пути по умолчанию, UNC/device path запрещён, symlink/junction самого root отвергается. Выбирается только доверенный локальный снимок; проверка root не заменяет проверки его родительских директорий владельцем.

Пример формы команды (путь нужно заменить; этот пример не запускался):

```text
node scripts/pdf-storage-inventory.cjs --root "D:\trusted-copy\pdf-results"
```

CLI читает readdir/lstat только верхнего уровня; регулярные `.pdf`/`.PDF` учитываются по size/mtime. Директории, symlinks/junctions, прочие расширения и иные типы считаются отдельно в ignored; обхода вложенных каталогов и чтения содержимого нет. Вывод JSON не содержит root, имён файлов или job IDs. `scannedAt`, files, bytes, oldestMtime/newestMtime и четыре возрастных диапазона дают воспроизводимый снимок.

Диапазоны: менее 1 ч; 1–24 ч; 1–7 дней; не менее 7 дней. Это возраст mtime, а не generatedAt и **не разрешение удалить** (`ageIsDeletionEligibility: false`). CLI не читает Redis/DB/S3/env и не знает, какие jobs активны, какие файлы осиротели или какие документы требуют сохранения.

`status: complete`, `partial: false`, exit 0 означают успешный **ограниченный flat inventory**, включая возможный пустой каталог. Ошибка аргументов, root/readdir или метаданных даёт errors > 0, `status: partial`, `partial: true`, exit 1; частичный результат не использовать как доказательство свободного места или отсутствия файлов. Нет unlink/rm/delete, автоматической уборки, установки пакетов и сетевых вызовов. Не загружать в инструмент архивное media-хранилище под видом temporary results.

В этой задаче запускались только собственные `codex-pdf-inventory-*` fixtures внутри worktree. Tests проверяют regular PDF, nested directory, junction, отсутствие утечки имён, missing/empty root и детерминированный отказ lstat через preload только в тестовом дочернем процессе. Удаляются только собственные fixtures после проверки workspace-relative пути. Директории владельца и production не сканировались.

Для S3 нужен отдельный полный пагинированный inventory с provenance, pagination completeness и ошибками. `listFiles` сейчас делает один ListObjectsV2 без continuation (`src/core/storage/s3-service.ts:127–137`), поэтому его результат нельзя объявить полным списком. Это ещё не реализовано; credentials, live bucket и lifecycle здесь не проверялись.

## Числовой расчётный лист: диск

| Вход или резерв | Значение | Статус |
|---|---:|---|
| Ёмкость VPS | 30 ГБ | Вход владельца; не измерение filesystem capacity |
| Порог disk-guard | 85% used | Default исходника `scripts/disk-guard.sh:18,27`; установка не подтверждена |
| Остаток на пороге | 30 × 15% = 4.5 ГБ | Арифметика при допущении, что весь объём доступен этому filesystem |
| Временное место сборки app+workers | исторически 5–6 ГБ | `docs/runbooks/013-prod-timers.md:27`; свежий peak не измерен |
| Разница остатка и исторического build peak | от −0.5 до −1.5 ГБ | Потенциальный конфликт reserve, не текущий отказ сервера |
| DB + WAL + локальные dumps | ___ ГБ | Владелец измеряет реальные занимаемые объёмы |
| Docker images/cache + сохранённые rollback images | ___ ГБ | Не удалять rollback ради свободного места; runbook013:31–43 |
| Media / MinIO / temporary PDF / monitoring / logs | ___ ГБ по классу | Не складывать S3 bytes с VPS bytes, если это внешний backend |
| Прирост до следующей проверки | ___ ГБ за ___ дней | Два датированных полных снимка одного scope, не оценка по числу тестов |
| Workspace реального restore + запас | ___ ГБ | Нужны измеренный сценарий и решение владельца |

Условие допуска к будущей сборке: **free disk ≥ max(измеренный дополнительный build peak, restore workspace) + резерв rollback + прирост до следующей проверки + запас владельца**. При одновременных сценариях их расходы суммируются. Не выбирать новый threshold по одному старому числу 6 ГБ; сначала измерить actual filesystem, peak, retained images и growth. Снимки partial и значения без даты для допуска не годятся. Никаких prune/удалений эта задача не запускает.

## Числовой расчётный лист: RAM

| Вход или нагрузка | Значение | Статус |
|---|---:|---|
| RAM VPS | 3.8 ГБ | Вход владельца; доступная RAM/swap не измерялись |
| PDF concurrency | default 2 jobs | `src/workers/unified-worker/config.ts:9`; actual настройка неизвестна |
| App + worker peak RSS | ___ + ___ ГБ | Нужен пик при representative concurrent jobs, не completed-only RSS |
| PostgreSQL + оба Redis + PgBouncer | ___ ГБ | Архитектура сохраняется; эти компоненты не удалять ради бюджета |
| Monitoring + OS + запас владельца | ___ ГБ | Нужны actual peak и отдельный запас |

Условие RAM: **сумма peak RSS компонентов + OS/monitoring + запас ≤ фактически доступная RAM**. Конфигурационные лимиты не равны потреблению. PDF целиком формируется в Buffer перед записью; после completed пишется RSS/heap (`src/workers/unified-worker/pdf.ts:39–62,81–88`), этот лог не ловит предыдущий peak. Unit fixtures не являются load test. Снижение concurrency, новые resource limits и изменения compose требуют отдельного решения после измерения.

## Варианты политики — только на выбор владельца

1. **Пока хранить всё:** принять временный мониторинг роста и reserve, ничего не удалять. Минимальный риск потери evidence; риск неограниченного накопления остаётся.
2. **Окно только для temporary pdf-results:** например, обсуждать 24 ч либо 7 дней, явно не как принятый срок. До реализации подтвердить потребность скачивания, исключение active/in-progress jobs, retry/race safety и допустимость регенерации. Более долгий срок файла сам по себе не продлевает доступ через expired BullMQ job. Правило не распространяется на media и reportPdfKey.
3. **Архивировать нужные документы отдельно:** владелец выбирает срок и классы evidence, подтверждает off-site/versioning/restore и идентичность нужных документов; только затем решает судьбу temporary results. Перенос, удаление или автоматический S3 lifecycle этим документом не разрешены.

Завершение I11 требует: выбранной и принятой владельцем политики; полного inventory каждого actual backend; измеренного disk/RAM budget; отдельного безопасного dry-run с проверкой исключений и только затем разрешения на действия, меняющие данные. Текущий CLI — инструмент измерения, а не такой deletion dry-run. Off-site/media recovery и live acceptance остаются I12; DB restore fixture из I07 не заменяет их.

## Локальная проверка первого шага

`npx.cmd vitest run src/lib/__tests__/pdf-generator.test.ts`: содержательный RED минимального scanner — 13 passed / 3 failed (followed junction, ошибочно counted directory/link, скрытый metadata error); после guards — 16 passed / 0 skipped, exit 0. Исполняемый storage/queue/media business code не менялся. Tsc и ESLint фиксируются отдельными реальными результатами в итоговом CODEX-REPORT; production usage, load и S3 completeness не проверялись.
