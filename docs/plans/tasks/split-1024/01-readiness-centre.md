# Задание 1 из 4: `readiness-centre.tsx` (1386 строк)

Сначала прочитать `00-common.md` — правила и критерии «готово» оттуда обязательны. Ветка: `codex/split-readiness-centre`. Файл не в замороженной зоне.

## Что в файле (по строкам на момент составления; сверить с реальным файлом)

| Строки | Содержимое | Куда |
|---|---|---|
| 27–204 | `RoleStepHint`, `ROLE_FLOW`, экспорты `RoleFlowStep`, `RoleFlowProgress`, `buildRoleFlowProgress`, `stepOwner` | `readiness-centre-role-flow.ts` |
| 204–361 | компоненты `RoleStepsPanel`, `RoleFlowFooter`, `StageLink` | `readiness-centre-role-panels.tsx` |
| 362–568 | константы подписей и классов (`STAGE_PILL`, `STAGE_OWNER`, `HANDOVER_*`, `BLOCKER_COUNT_*`), `countBlockersByTone`, `ReadinessMetricTile`, `buildReadinessMetricTiles` | `readiness-centre-metrics.ts` (если JSX внутри — `.tsx`) |
| 569–612 | компонент `HandoverEvent` | `readiness-centre-handover.tsx` |
| 613–1364 | `ReadinessCentre` — один компонент, ~750 строк, тело замыкает десятки локальных значений | **остаётся в `readiness-centre.tsx`** |
| 1365–конец | `EVIDENCE_STAGE`, `evidenceMetric` | можно в `readiness-centre-metrics.ts`, если нет циклических импортов |

Новые файлы класть рядом: `src/components/piling/to/readiness/screens/`. Имена выше — предложение; менять можно, но одинаково осмысленные и с префиксом `readiness-centre-`.

## Порядок шагов (один коммит на шаг)

1. Базовая линия (см. `00-common.md`, п. «Метод» 1) плюс: `npx vitest run src/components/piling/to/readiness/screens/__tests__/readiness-centre.test.tsx` — записать passed/failed.
2. Перенос 27–204 (чистые данные и функции без JSX) → `readiness-centre-role-flow.ts`. Переэкспорт типов `RoleFlowStep`, `RoleFlowProgress` из `readiness-centre.tsx`.
3. Перенос 204–361 (панели) → `readiness-centre-role-panels.tsx`.
4. Перенос 362–568 и 1365–конец (константы, подсчёты, плитки) → `readiness-centre-metrics.ts(x)`.
5. Перенос `HandoverEvent` → `readiness-centre-handover.tsx`.
6. Финальные проверки из `00-common.md`.

После каждого шага: `tsc`, `lint`, тест `readiness-centre.test.tsx` и тесты в `src/components/piling/to/__tests__/` зелёные; `check-pure-move.cjs` с кодом 0.

## Что не делать

- **Не резать тело `ReadinessCentre`** (JSX на ~600 строк и ~160 локальных значений перед ним): без новых параметров не вынести, а это уже правка. Ожидаемый итог — `readiness-centre.tsx` около 800 строк вместо 1386; цель «≤ 500» здесь **не обязательна**. Написать в отчёте, какие блоки JSX можно вынести отдельной задачей и сколько параметров им потребуется — но не выносить.
- Не трогать `readiness-reference-ui.tsx` и импорт `ReadinessCentre` в нём.
- Не менять тексты на экране, классы, порядок JSX.

## Готово, когда

Все критерии `00-common.md` выполнены; импорты `ReadinessCentre` в `readiness-reference-ui.tsx` и в тесте не изменились; `check-pure-move.cjs` даёт 0 на финальном состоянии; в отчёте — таблица файлов и вывод скрипта.
