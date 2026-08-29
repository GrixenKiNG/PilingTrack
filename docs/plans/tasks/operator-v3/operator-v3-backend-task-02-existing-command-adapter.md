# Серверная задача 02 — адаптер действующих команд

**Зависимость:** серверная задача 01. **Результат:** нормативные команды v3 используют единую атомарную оболочку и после выполнения возвращают новый снимок.

## Файлы

- Создать `src/modules/operator-v3/application/commands/{envelope-schema,operator-command-errors,existing-command-adapters,operator-command-registry,execute-operator-command}.ts`.
- Создать `src/app/api/operator/v3/_shared/{request-context,command-route}.ts`, `src/app/api/operator/v3/commands/[command]/route.ts`.
- Точечно расширить `src/modules/readiness/application/shifts/commands.ts`, `src/modules/inspections/application/commands/inspection-commands.ts`, `src/modules/equipment/application/commands/meter-reading.ts`.
- Создать `tests/contract/operator-v3-commands.spec.ts`, `src/modules/operator-v3/application/commands/__tests__/execute-operator-command.test.ts`; раскрыть пятый случай интеграционного файла.

## Выполнение через красные тесты

1. Зафиксировать грязное дерево и отдельные diff трёх изменяемых файлов; не затирать чужие правки.
2. GitNexus: `query("idempotency audit outbox tenant transaction shift start inspection meter")`; `context` для `executeIdempotentCommand`, `createShiftCommand`, `startShiftCommand`, команд осмотра и моточасов; upstream `impact` каждого экспортируемого символа до правки. HIGH/CRITICAL сначала сообщить владельцу.
3. Красными тестами зафиксировать команды `accept-assignment`, `accept-equipment`, `create-inspection`, `save-inspection`, `complete-inspection`, `confirm-work-zone`, `record-meter`, `complete-preparation`, `start-shift`.
4. Добавить отрицательные случаи: несовпадение `Idempotency-Key`/`commandId`, отсутствующий `If-Match` у критической команды, устаревшая версия, повтор с другим содержимым, чужая организация, английская наружная ошибка.
5. Реализовать конверт `commandId`, `aggregateId`, `expectedVersion`, `deviceId`, `occurredAt`, полезную нагрузку и контрольную сумму. Реестр — закрытый перечень; клиентский произвольный маршрут запрещён.
6. Одна транзакция проверяет организацию, назначение и версию, пишет деловой факт, аудит, исходящее событие и квитанцию. Повтор не вызывает адаптер второй раз.
7. Возвращать `COMPLETED`, `replayed`, ту же `newVersion`, исходный результат и новый снимок. Ошибки сопоставлять с безопасными русскими сообщениями.
8. Прогнать проверки и `detect_changes`; доказать отсутствие дубля в БД, аудите и исходящих событиях.

## Проверка

```powershell
npx.cmd vitest run src/modules/operator-v3/application/commands/__tests__/execute-operator-command.test.ts
npm.cmd run test:contract -- --run tests/contract/operator-v3-commands.spec.ts
npx.cmd vitest run tests/integration/operator-v3-workplace.spec.ts
npx.cmd tsc --noEmit
```

## Готово, когда

- все девять команд доступны только из серверного реестра и возвращают новый снимок;
- повтор возвращает исходную квитанцию с `replayed: true` и не создаёт вторых записей;
- конфликт версии и повтор ключа с иной нагрузкой отклоняются без частичного эффекта;
- все наружные тексты русские, секреты и внутренние исключения не раскрыты;
- старые API и v2 сохраняют поведение.

