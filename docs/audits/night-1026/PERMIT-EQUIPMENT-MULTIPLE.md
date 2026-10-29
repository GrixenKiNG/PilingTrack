# Предложение: выбор назначенной бригады по запрошенной установке

Статус: ОЖИДАЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА. Код приложения не изменён. RED и реальные ответы/SQL: EQUIPMENT-MULTIPLE-RED.md/json.

AGENTS.md §1 запрещает правки «anything RLS/tenancy-related». Общее назначение участвует в ограничении доступа. Прежнее разрешение GET паспорта сюда не относится. Прошу исключение только на следующие строки трёх прикладных файлов и проверки в существующих тестах.

1. src/modules/crews/application/queries/crew-query.service.ts, только getCrewForOperator:

```diff
-  requestedOperatorId?: string | null
+  requestedOperatorId?: string | null,
+  equipmentId?: string
 ...
     where: {
+      ...(equipmentId !== undefined ? { equipmentId } : {}),
       OR: [
```

Новый фильтр — AND с существующим OR пользователя/помощника. Проверка !== undefined сохраняет фильтрацию даже для пустой строки. Без третьего аргумента запрос идентичен старому.

2. В каждом из двух локальных assertOperatorOwnsEquipment:
- src/app/api/equipment/[id]/fuel/route.ts
- src/app/api/equipment/[id]/meter-readings/route.ts

```diff
-  const crew = await getCrewForOperator(user, null);
+  const crew = await getCrewForOperator(user, null, equipmentId);
```

Итого3прикладных файла,ориентировочно5добавлений/3удаления. /api/crews/my продолжает свой вызов с двумя аргументами и не меняется. Не меняются tenant namespace/фильтры, role/actingAs, OR operator/assistant, isActive, права других ролей, auth/RLS/CSRF/rate-limiter, транзакции, schema/migrations. Новое правило активности не добавляется: оно отдельно не доказано этим RED.

GitNexus HIGH:2guard и4HTTP-обработчика; дополнительный динамический /api/crews/my найден текстом. До правки и перед коммитом — полные impact/detect_changes.

Проверки после разрешения: RED отдельным коммитом; unit в существующих query/route тестах — точный equipmentId, отсутствие третьего аргумента, прежние роли; браузер GET/POST обеих назначенных установок200/201, неназначенная403/404, SQL2+2 иaudit4 с actorId оператора. Затем новая сборка с новым прикладным SHA, последовательные tsc/lint/полный unit/Playwright collection и связанные браузерные сценарии; старую451не выдавать за новую. Новых файлов тестов не требуется.
