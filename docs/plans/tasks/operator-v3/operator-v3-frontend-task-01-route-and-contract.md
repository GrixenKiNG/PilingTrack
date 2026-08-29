# Клиентская задача 01 — маршрут и строгий договор

**Зависимость:** серверная задача 01. **Результат:** `/operator/v3` работает в общей оболочке и рисует только полностью проверенный серверный снимок.

## Файлы

- Создать `src/app/(app)/operator/v3/{page,loading,error}.tsx`.
- Создать `src/components/piling/operator-v3/api/{wire-contracts,contracts,normalize-workplace,operator-v3-client,api-error,action-registry}.ts`.
- Создать `src/components/piling/operator-v3/operator-v3-labels.ts`.
- Создать `src/components/piling/operator-v3/state/{workplace-reducer,operator-workplace-provider}.tsx` и `use-operator-workplace.ts`.
- Создать `src/components/piling/operator-v3/__tests__/{wire-contracts,workplace-reducer}.test.ts`.

## Выполнение через красные тесты

1. Зафиксировать состояние дерева. Не менять `layout.tsx`, `role-navigation.ts`, v2 и общий стиль.
2. GitNexus: `query("app layout operator route role navigation query provider")`; `context` корневой страницы `/operator`, общей оболочки и readiness-клиента. Если всё же меняется существующий символ — обязательный upstream `impact` до правки.
3. Сначала получить красные тесты: неизвестное значение состояния отвергается; отсутствующее обязательное поле не создаёт частичный экран; клиент не вычисляет фазу; ошибки русские; повторное получение заменяет только подтверждённый снимок.
4. Создать отдельные проволочный и внутренний договоры. Нормализатор либо возвращает полный снимок, либо типизированную ошибку — без частичного значения и подстановок.
5. Клиент обращается только к `/api/operator/v3/workplace`; не импортирует v2, `resolveShiftPhase` и `/api/operator/shift`.
6. Поставщик хранит состояния загрузки, готовности, отсутствия назначения и безопасной ошибки. Редуктор не содержит деловых переходов фаз.
7. Страница сохраняет общую оболочку, имеет `data-testid="operator-v3-workplace"`; `loading.tsx` и `error.tsx` доступны с клавиатуры и содержат русские тексты.
8. Проверить прямое открытие и обновление адреса, затем `detect_changes`.

## Проверка

```powershell
npx.cmd vitest run src/components/piling/operator-v3/__tests__/wire-contracts.test.ts src/components/piling/operator-v3/__tests__/workplace-reducer.test.ts
npx.cmd tsc --noEmit
npm.cmd run build
```

## Готово, когда

- прямой `/operator/v3` открывается в единственной общей оболочке;
- невалидный снимок попадает в безопасную границу, частичный интерфейс не появляется;
- фаза, готовность и действия не вычисляются на клиенте;
- обновление восстанавливает подтверждённый снимок;
- v2, навигация и общая оболочка не изменены.

