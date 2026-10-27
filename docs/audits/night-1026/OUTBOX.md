# Отказные сценарии outbox на реальном PostgreSQL

База исходников efd95008. Новые сценарии:05bc33fc. Минимальное исправление по отдельному разрешению владельца:48aa4689. Общая схема, модель повторов, архитектура и механизм DLQ не менялись.

## Окружение и метод

Файл src/modules/reports/application/__tests__/outbox-failures.integration.test.ts сам создаёт ОТДЕЛЬНЫЙ postgres:18-alpine через штатный scripts/test-db-up.sh. Это не БД живого стенда, поэтому app/embedded/unified workers не могут украсть тестовое событие. Применяются все миграции и app/identity grants. Проверено current_user=pilingtrack_app, rolsuper=false,rolbypassrls=false. Credentials только в памяти child/supervisor, .env не используется. После тестов контейнер удаляется штатным test-db-down.sh.

lib/db направлен на реальный PrismaPg application client с настоящими GUC/transaction wrappers. SQL не мокался. Обработчики отказа/здоровья инъецированы как разрешает API consumer; поэтому эти сценарии доказывают транспорт/retry/claim, а не правильность каждой бизнес-проекции или внешней доставки.

## Результаты

| Сценарий | Наблюдение | Вывод |
|---|---|---|
| Публикация падает5раз, проектор здоров | После первой ошибки project возвращает0из-за общего nextRetryAt; после бюджета5есть1DLQдляpublished; после наступления срока project выполняется1раз | **Подтверждено** взаимное влияние backoff; флаги завершения сохраняют раздельность |
| Проектор падает5раз, публикация здорова | Зеркальный результат, DLQconsumer=projected | **Подтверждено** симметричное общее retry-состояние |
| Настоящий process crash между side effect и claim | Отдельный Node worker сначала записывает retry, затем другой процесс коммитит markerиумираетсexit23; свежий процесс повторяет идемпотентный markerификсируетpublished | Событие не потеряно; в БД1marker. Повторная доставка после crash есть, exactly-once consumer НЕ доказан |
| Уже обработанная строка | Второй poll возвращает0, handler вызывался1раз, строка неизменна | Подтверждено отсутствие повторной обработки штатного обработанного row |
| tenantId отсутствует | До правки handler вызывался1раз и published=true; после guard оба consumer не вызывают handler, остаются в retry | **ДЕФЕКТ OUTBOX-TENANT-001**, воспроизведён и исправлен |

Для прохождения retry-окон тест обновляет nextRetryAt только у собственной строки в собственной БД на прошедшее время; это контролируемое продвижение времени, не изменение production backoff. MAX_OUTBOX_RETRIES=5. Без этого ожидание всех jitter-интервалов не нужно для доказательства взаимного влияния потребителей.

Crash-marker — AuditLog.upsert по устойчивому ID тестового события. Это доказательство механизма с идемпотентным обработчиком, не обещание отсутствия дублей Telegram/PDF при внешнем побочном эффекте. Этот предел сохранён явно.

## Красный и зелёный прогон

- outbox-faults-first:exit1,4passed/1failed/0skipped,29секунд. Единственное падение — tenantless handler invocation.
- outbox-faults-green:exit0,30passed/0failed/0skipped,30секунд. Включает5реальных PostgreSQLсценариев, существующие worker-unit и проверки отказа DLQ.
- Старому фабричному unit fixture добавлен canonical tenantId; утверждения о retry/DLQ/handler не ослаблялись. Явный tenantless PGслучай сохранён и усилен проверкой обоих потребителей.

Команда зелёного прогона: node node_modules/vitest/vitest.mjs run src/modules/reports/application/__tests__/outbox-failures.integration.test.ts src/modules/reports/application/__tests__/outbox-publisher.dlq.test.ts src/workers/__tests__/outbox-worker.test.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=D:/PillingR/night-logs/night-evidence-1026/outbox-faults-green.json.

## Что изменилось и что осталось

Перед вызовом обработчика проверяется **каноническая колонка tenantId**, а не tenantизpayload. Если её нет, обычный catch сохраняет ошибку и повторяет, затем направляет в штатную DLQ. После терминального DLQфлагconsumerможетстатьtrueкакметкаокончанияочереди;этоНЕуспешныйвызовбизнесобработчика. Старые tenantless строки теперь требуют явного разбора/backfill. Схема и миграции не изменены; автоматический backfill не выполнялся.

Общие attempts/nextRetryAt/lastError намеренно не разделялись. Синхронность consumer flags не означает независимость бюджета повторов; риск из модульного отчёта подтвердился, но рефакторинг запрещён заданием.

## GitNexus

Impact на правильно перестроенном индексе собственной WT:7затронутыхсимволов,двапрямыхconsumer,LOW;цепочкиподтвержденыисходникамиworker/projection. Инкрементальное обновление однажды потеряло target и выдало при поиске по имени CRITICALснерелевантнымисвязями. Пользователь предупреждён, правка остановлена; analyze --force --index-only восстановил корректные ID/связи, повторный impactLOW. Противоречивый результат сохранён, не принят за разрешение на правку. Перед48aa4689полный detect_changes видитconsumeOutboxEvents,безpartial/truncated.

Настоящий production контур, внешняя сеть и все обработчики бизнес-событий здесь не проверялись. Логи/JSON: D:/PillingR/night-logs/night-evidence-1026/.
