# Клиентская задача 02 — семь фаз и начало работы

**Зависимости:** серверные задачи 01–02 и клиентская задача 01. **Результат:** настоящий оператор проходит путь от назначения до начала смены.

## Файлы

- Создать `src/components/piling/operator-v3/{operator-workplace-screen,equipment-header,phase-route,current-step-card,readiness-panel,operator-action-dock,persistent-safety-actions,operator-live-region}.tsx`.
- Создать семь компонентов `src/components/piling/operator-v3/steps/*-step.tsx` по клиентскому проекту.
- Создать `forms/{inspection-form,meter-reading-form}.tsx`, `state/use-operator-command.ts`.
- Создать тесты `operator-workplace-screen.test.tsx`, `action-registry.test.ts`; включить первый сценарий `e2e/operator-v3/operator-evidence.spec.ts`.

## Выполнение через красные тесты

1. Сохранить исходный статус и diff пересекающихся файлов; v2 не менять и не импортировать.
2. GitNexus: `query("operator dashboard inspection form meter dialog start shift UI")`; `context` для `OperatorDashboard`, `MeterReadingDialog` и форм осмотра. Перед любым изменением существующего/общего символа — upstream `impact`; предпочтительны новые v3-компоненты.
3. Красные компонентные тесты: ровно семь элементов маршрута; ровно одно главное действие; три постоянных действия доступны на каждой фазе; подписи русские; решение готовности объяснимо без процента.
4. Красные командные тесты: использовать только серверные `route`, `method`, `expectedVersion`; блокировать повторное нажатие одним `commandId`; после успеха применять возвращённый снимок, а не локально переключать фазу.
5. Собрать task-first экран: заголовок установки, маршрут, текущий шаг, панель готовности, одно главное действие и постоянная безопасная панель. Не создавать вторую шапку/навигацию.
6. Реализовать формы осмотра и моточасов с доступными подписями, проверкой ошибок, возвратом фокуса и живой областью. Дефект, опасное событие и фотография видимы всегда, даже если соответствующие формы будут реализованы следующим срезом.
7. Пройти реальным `operator@piling.ru`: назначение → получение → осмотр → рабочая зона → моточасы → готовность → пуск. Для каждого шага сохранить запрос, одну запись, квитанцию, повторное чтение, обновление страницы.
8. Проверить телефон 320–480 пикселей, клавиатуру, отсутствие ошибок консоли; выполнить `detect_changes`.

## Проверка

```powershell
npx.cmd vitest run src/components/piling/operator-v3/__tests__/operator-workplace-screen.test.tsx src/components/piling/operator-v3/__tests__/action-registry.test.ts
npx.cmd vitest run tests/integration/operator-v3-workplace.spec.ts
npx.cmd playwright test e2e/operator-v3/operator-evidence.spec.ts --project=chromium --workers=1
npm.cmd run build
```

## Готово, когда

- все семь фаз показаны, но только текущая управляет одним главным действием по серверному снимку;
- постоянные безопасные действия не исчезают ни на одной фазе;
- полный путь доказан реальной ролью, серверной записью, обновлением и повторным чтением;
- ошибки русские, фокус и живая область работают; консоль чистая;
- `/operator` и `/operator/v2` не изменили поведение.

