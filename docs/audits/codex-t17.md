# Поток 17 — приложение

Рабочее дерево `D:/PillingR/wt-codex17`, ветка `codex/app-fixes-1010`, база `e6aef7a4`. Push, merge, SSH и выкладка не выполнялись. Зависимости, схема и миграции не менялись. Изменения экранов оператора разрешены заданием и сопровождаются тестами.

GitNexus MCP недоступен; CLI не установился из-за @ladybugdb/core / spawnSync cmd.exe ENOENT. Пользователь разрешил текстовый fallback для потоков 16/17. Поиск вызывающего кода и diff выполняются, но callers/processes/graph risk остаются UNKNOWN.

## Часть 1

| Задача | Статус и изменение | Коммит | Проверки |
|---|---|---|---|
| A1 | Сделано: effectiveRole в настройках, мониторинге и серверных изменениях раскладки. Историческая роль автора аудита не подменяется действующей ролью | 690f33a4, 20719ab5 | Red 59 passed / 4 failed → green 63 passed; раскладка red 6 passed / 2 failed → green 8 passed. tsc / scoped eslint / diff: exit 0 |
| A2 | Сделано: первоначальный отказ Redis для PDF повторно проверяется после 30 секунд; probe connection закрывается | eb0033d1 | Red 12 passed / 1 failed → green 30 passed / 0 skipped, exit 0; tsc / scoped eslint: exit 0 |
| A3 | Сделано: draft schema v3 содержит reportId, известный shiftId и baseVersion; восстановление после загрузки сервера. Чужой или старый несовместимый черновик сохранён на устройстве, автозапись поверх него запрещена | 4abf99ca | Red 17 passed / 4 failed → green 23 passed / 0 skipped, exit 0; tsc / scoped eslint / diff: exit 0 |
| A4 | Сделано: name + id в четырёх query services, все страницы в трёх hooks. Сохранены фильтры, abort, кодирование cursor; повтор cursor считается ошибкой. /sites/all остаётся непагинированным | 3be5756a | Red 8 failed / 106 skipped → green 8 файлов, 133 passed / 0 skipped, exit 0; tsc / scoped eslint / diff: exit 0 |
| A5 | Сделано: пять UI consumers скрывают ссылки users/dictionaries по существующим effective permissions; строки пользователей остаются текстом | 1694209c | Red 5 failed / 4 passed / 24 skipped → green 33 passed / 0 skipped, exit 0. Все пять consumers проверены DOM; четыре используют actual useAbility с DISPATCHER / ADMIN acting DISPATCHER / ADMIN. tsc / scoped eslint / diff: exit 0 |
| A6 | Сделано: image CI service postgres:16 → postgres:18-alpine. Job использует свой service container; ручные scripts с образом 16 не вызываются этим job и оставлены | c132caf | Builtin assert red exit 1 → green exit 0; diff exit 0. Дополнительный YAML parser exit 1: модуль yaml отсутствует, не устанавливался. Hosted CI / живой PG18 job не запускались |

## Новые отчёты Hermes

Предел задания — 12 логических исправлений. A1 потребовал отдельной второй правки серверного guard раскладки; с A2–A6 это семь исправлений. Для части 2 выбраны пять: AU188 → AU178 → AU175 → AU185 → AU164. Остальные не исправляются сверх лимита.

| Отчёт | Проверенный вывод / решение |
|---|---|
| AU188 | Сделано c157b9b5: лимит должен быть положительным safe integer; Number не принимает суффикс вместо полного числа. Red 8 failed / 16 passed → green 6 файлов, 76 passed / 0 skipped, exit 0; tsc / scoped lint / diff exit 0. Гипотеза о неограниченном presign не подтверждена: ContentLength уже привязан |
| AU178 | Сделано c9067f13: событие incident.reported записывается в той же транзакции, лог — после commit; повтор clientCommandId не дублирует след. Имя/сырую историческую роль автора читает tx.user; metadata — ограниченный список полей происшествия без media payload. Formatter доступен через существующий system facade. Red 4 failed / 2 passed → green 14 файлов, 254 passed / 0 skipped, exit 0; final tsc / scoped lint / diff exit 0. Реальный DB rollback не проверялся: тесты используют mock транзакции. Provision/revoke device keys защищены AGENTS; не меняются |
| AU167 | ADMIN/DISPATCHER имеют платформенные права по решению владельца; это не утечка. Telegram test route уже проверяет telegram.manage. Новая политика ролей не вводится |
| AU168 | Предложенная ночная смена 19–07 противоречит решению владельца: работа только днём. Вчерашняя работа дописывается в явно показанную вчерашнюю смену, затем ручное закрытие и новая смена. Иные правила даты не вводятся |
| AU175 | Сделано c00d00ae: enqueueCriticalDefects внутри транзакции только для новых toCreate дефектов. Red 22 passed / 2 failed → green 24 passed / 0 skipped, exit 0; scoped lint / tsc / diff exit 0. В red PowerShell wrapper перезаписал exit командой чтения лога: exit runner не сохранён, red подтверждён счётчиком failed, а не записанным exit. NORMAL, открытый sourceKey и повтор завершения не уведомляют. Переклассификация triage предусмотрена существующими правилами |
| AU185 | Сделано 7cb101db: из DONE/CANCELLED нельзя перейти в другой статус; CANCELLED нельзя принять; при создании DONE/CANCELLED действуют существующие требования описания/причины. API сохраняет cancelReason. Осмотр завершает только OPEN_MAINTENANCE, отменённый наряд не оживает. PLANNED → DONE и редактирование непринятой записи без смены terminal статуса сохраняются. Red 61 passed / 10 failed, exit 1 → green 3 файла, 71 passed / 0 skipped, exit 0; tsc / scoped lint / diff exit 0 |
| AU164 | Сделано 8f58e60e: reviewNote передаётся DTO/query и отображается обычным React-текстом в shared screen (v1/v2/v5), v7 и v10. NULL сохраняет общий статус; literal HTML проверен как текст. Red 7 failed / 1 passed / 19 skipped, exit 1 → green 3 существующих specs, 27 passed / 0 skipped, exit 0; tsc / scoped lint / diff exit 0. Фото и новые требования к разбору не добавляются |
| AU187 | Реальный риск устаревшего response cache пользователей/техники после mutations. Пропущено из-за предела 12; требуется отдельная задача |
| AU189 | Реальная потеря недельных строк при более десяти объектах из-за take = weeks * 10. Пропущено из-за предела 12; календарную политику не меняем |
| AU165 | Clock skew/offline требует решения о доверии времени устройства и отдельного воспроизведения. Новые правила occurredAt не вводятся |
| AU184 | SELECT 1 не имеет отдельного deadline; истощение DB pool не воспроизведено. Защищённую инфраструктуру БД/tenancy не меняем |
| AU172 | Главная находка о бессрочном запросе устарела: api.ts уже ограничивает fetch и чтение тела 20 секундами, upload — 120 секундами. Retry UX не исправляется сверх лимита |
| AU169 | TileErrorBoundary без отдельной диагностической callback — улучшение надёжности, а не воспроизведённый P0. Пропущено из-за приоритета и лимита |
| AU176 | Узкие таблицы требуют браузерного воспроизведения; responsive wrappers уже есть. Пропущено из-за приоритета и лимита |
| AU171 | Матрица документов помощника требует решения владельца. Новые документы/обязанности роли не назначаются |
| AU166 | Только чтение: activeToday отличается от workingNow; подпись top-10 соответствует ограничению выборки |
| AU170 | Только чтение: standalone worker Sentry в исходной версии не задаёт environment; production delivery не проверялась. Исправления SDK выполнялись отдельно в потоке 16 |
| AU173 | Только чтение: DROP lastAcceptedSequence и RefreshToken необратимы без восстановления данных; миграции не менялись |
| AU174 | Только чтение: onboarding-документ содержит устаревшее passwordHash; seed не разрешён для production |
| AU182 | Только чтение: дубли NETWORK_ERROR/catchText подтверждены; новый i18n framework не вводится |

Дополнительно просмотрены заголовки и выводы AU177/179/180/181/183/186. Они не входят в явный перечень работ части 2: унификация API-ошибок, единиц топлива, Docker-слоёв, правил приёмки, клавиатурных окон и состояний загрузки не добавляется сверх лимита. Их модельные выводы не объявлены воспроизведёнными дефектами.

## Ограничения

Сырой role в fleet tenant scope оставлен: это защищённая tenancy-область. Исторические подписи роли автора аудита и намеренный ADMIN bootstrap gate сохранены. ORION не менялся. Тесты не подключаются к production; .env не читаются. Интеграции без DB пропускаются и будут отражены отдельным числом.

## Итоговые проверки

Стандартный Vitest config читает .env. Для проверок использована ignored копия `output/codex-t17/vitest.no-env.config.ts` без dotenv loader, envDir=false, с прежними plugins/includes/setup. Файловый preload `output/codex-t17/no-secret-files.cjs` блокирует чтение .env; DB/Redis URL очищены в окружении дочернего процесса. Конфиги приложения и secrets не изменялись.

| Проверка | Exit | Результат |
|---|---:|---|
| .next/dev/types | 0 | Каталог отсутствует |
| npx playwright test --list | 0 | 291 тест в 27 файлах; совпадает с потоком 16, e2e specs не удалялись. Браузерные тесты не запускались |
| npm run build с файловым guard | 1 | Нет DATABASE_PROVIDER / SESSION_SECRET; Next compilation не началась. Повторено на финальных исходниках после AU164 с тем же результатом |
| Prisma generate с ignored config без dotenv/datasource | 0 | Client 7.10.0; patch-postgres-client.js отдельно exit 0 |
| npx tsc --noEmit на финальных исходниках | 0 | Типы проверены после всех 12 исправлений |
| npm run lint | 0 | Ноль ESLint warnings, text integrity passed |
| npx vitest run --config output/codex-t17/vitest.no-env.config.ts --maxWorkers=2 --testTimeout=30000 | 0 | 392 файлов прошли / 13 пропущены; 4239 passed / 2 expected fail / 257 skipped, всего 4498; 364.25 секунды |

JSON Vitest считает expected failures частью passed (4241); выше раздельные числа текстового reporter. Пропущенные DB-интеграции не выдаются за проверенные. Next route types сборкой не проверены, поэтому полная приёмка с build остаётся открытой. Hosted CI и реальные DB rollback/concurrency не проверялись. Финальный отчёт фиксируется отдельным коммитом; все 12 коммитов исправлений перечислены выше. Push/merge не выполнялись.

## Изменённые файлы

| Путь | Строки относительно e6aef7a4 |
|---|---:|
| .github/workflows/integration.yml | +1 / −1 |
| src/app/api/equipment/[id]/maintenance/__tests__/route.test.ts | +9 / −0 |
| src/app/api/equipment/[id]/maintenance/route.ts | +1 / −0 |
| src/app/api/layout/[surfaceId]/route.ts | +3 / −2 |
| src/app/api/monitoring/template/route.ts | +2 / −1 |
| src/app/api/readiness-rules/__tests__/route.test.ts | +30 / −0 |
| src/app/api/reports/pdf/__tests__/route.test.ts | +25 / −2 |
| src/components/piling/__tests__/admin-dashboard.test.tsx | +14 / −1 |
| src/components/piling/__tests__/workspace-settings.test.tsx | +55 / −4 |
| src/components/piling/admin-crews/__tests__/use-crews-data.test.ts | +18 / −0 |
| src/components/piling/admin-crews/use-crews-data.ts | +8 / −8 |
| src/components/piling/admin-dashboard.tsx | +3 / −1 |
| src/components/piling/admin-equipment/__tests__/equipment-mobile-targets.test.tsx | +15 / −0 |
| src/components/piling/admin-equipment/use-equipment-list.ts | +15 / −18 |
| src/components/piling/admin-sites/__tests__/use-sites-overview.test.ts | +27 / −3 |
| src/components/piling/admin-sites/use-sites-data.ts | +8 / −5 |
| src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx | +12 / −4 |
| src/components/piling/monitoring/equipment-tile-editor.tsx | +2 / −1 |
| src/components/piling/operator-mobile/screens/__tests__/incidents-tab.test.tsx | +31 / −0 |
| src/components/piling/operator-mobile/screens/incidents-tab.tsx | +4 / −1 |
| src/components/piling/operator-mobile/v10/__tests__/operator-v10-flow.test.tsx | +21 / −0 |
| src/components/piling/operator-mobile/v10/operator-v10-app.tsx | +3 / −1 |
| src/components/piling/operator-mobile/v7/v7-screens.tsx | +1 / −0 |
| src/components/piling/report-form/__tests__/use-report-form.length.test.ts | +72 / −0 |
| src/components/piling/report-form/use-report-form.ts | +48 / −9 |
| src/components/piling/to/readiness-design-views.tsx | +4 / −1 |
| src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx | +8 / −0 |
| src/components/piling/to/readiness/screens/settings-workspace.tsx | +2 / −1 |
| src/components/piling/to/readiness/settings/dictionaries-section.tsx | +11 / −7 |
| src/components/piling/to/readiness/settings/roles-section.tsx | +8 / −5 |
| src/components/piling/workspace-settings.tsx | +8 / −6 |
| src/core/media/__tests__/confirm-upload-validation.test.ts | +19 / −2 |
| src/core/media/media-service.ts | +4 / −1 |
| src/lib/__tests__/pagination.test.ts | +28 / −1 |
| src/lib/pagination-cursor.ts | +26 / −0 |
| src/lib/pdf-queue.ts | +10 / −3 |
| src/modules/crews/application/queries/__tests__/crew-query.service.test.ts | +8 / −0 |
| src/modules/crews/application/queries/crew-query.service.ts | +1 / −1 |
| src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts | +37 / −0 |
| src/modules/equipment/application/commands/equipment-maintenance.ts | +8 / −0 |
| src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts | +8 / −0 |
| src/modules/equipment/application/queries/equipment-query.service.ts | +1 / −1 |
| src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts | +49 / −2 |
| src/modules/inspections/application/commands/inspection-commands.ts | +7 / −2 |
| src/modules/operator-mobile/application/commands/__tests__/incidents.test.ts | +111 / −0 |
| src/modules/operator-mobile/application/commands/incidents.ts | +36 / −5 |
| src/modules/operator-mobile/application/mobile-shift-query.test.ts | +16 / −0 |
| src/modules/operator-mobile/application/mobile-shift-query.ts | +2 / −1 |
| src/modules/operator-mobile/domain/view-contracts.ts | +2 / −0 |
| src/modules/sites/application/queries/__tests__/site-query.service.test.ts | +8 / −0 |
| src/modules/sites/application/queries/site-query.service.ts | +3 / −3 |
| src/modules/system/index.ts | +3 / −0 |
| src/services/audit/__tests__/audit-service.test.ts | +1 / −0 |
| src/services/audit/audit-service.ts | +4 / −0 |
| src/services/users/__tests__/user-service.test.ts | +8 / −0 |
| src/services/users/user-service.ts | +1 / −1 |

Файлы/экспорты не удалялись. Единственный новый test file — safety incidents regression, необходимый для задания об аудите операции безопасности. Все остальные регрессии добавлены в существующие specs. Схема, миграции, package.json/lock и защищённые auth/security/tenancy исходники не менялись: соответствующий git diff пуст. В main сохранено прежнее чужое изменение next-env.d.ts.
