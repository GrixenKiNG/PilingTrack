# Карта production-кандидата — 04.11.2026

## Зафиксированные refs

| Ref | Tip | Merge-base с `main` | Содержимое |
| --- | --- | --- | --- |
| `main` | `3b2c2e7fd12b2f2513b2251cccbc4f2bb89344f9` | — | База кандидата |
| `origin/main` | `c204d90e23588177a875cb9449269b89275db671` | — | На 7 commits позади локального `main` |
| `claude/pto-order-1030b` | `0471b4c5a4b971936e5c1f4a27ca645604f99bda` | `3b2c2e7f` | 1 commit |
| `claude/pto-acts-accepted-1030b` | `2394245c1386978b5aa11f635a6c33ab1d316582` | `3b2c2e7f` | 1 commit |
| `claude/pto-small-1030b` | `14c20a8fe61a9b47fb73a1f646473b59b4351042` | `3b2c2e7f` | 3 commits: `dcd39b5d`, `1cc8b0dc`, `14c20a8f` |
| `codex/split-deep-1030c` | `66a173ce726776496ec6755e02feb7f5ee7fa2d0` | `c204d90e` | 11 commits; включается вся вершина ветки |

## Полный состав split-deep

`1214b85b`, `c1b47114`, `6d3ddb16`, `d19a826a`, `e9d817ba`, `4aca38e2`, `d3a0209d`, `501fbead`, `5da6ee19`, `96c7779e`, `66a173ce`.

Ruling: включаются все 11 commits вершины `codex/split-deep-1030c`, потому что план объединяет ref целиком, а владелец признал последние правки правильными. Ограничение до трёх commits молча отбросило бы принятые изменения той же ветки.

## Изменённые файлы по веткам

### `claude/pto-order-1030b`

- `src/modules/reports/application/queries/__tests__/pile-journal-form41.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-order.integration.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-pto.integration.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-svod.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-xlsx.fixture.ts`
- `src/modules/reports/application/queries/pile-journal-form41.ts`
- `src/modules/reports/application/queries/pile-journal-list.ts`
- `src/modules/reports/application/queries/pile-journal-svod.ts`
- `src/modules/reports/application/queries/pile-journal-totals.ts`
- `src/modules/reports/application/queries/pile-journal-types.ts`

### `claude/pto-acts-accepted-1030b`

- `src/modules/reports/application/queries/__tests__/pile-journal-acts-accepted.integration.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-aook.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-aosr.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-xlsx.fixture.ts`
- `src/modules/reports/application/queries/pile-journal-aook.ts`
- `src/modules/reports/application/queries/pile-journal-aosr.ts`

### `claude/pto-small-1030b`

- `src/modules/reports/application/queries/__tests__/pile-journal-form41.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-joint-acts.test.ts`
- `src/modules/reports/application/queries/__tests__/pile-journal-svod.test.ts`
- `src/modules/reports/application/queries/pile-journal-form41.ts`
- `src/modules/reports/application/queries/pile-journal-joint-acts.ts`
- `src/modules/reports/application/queries/pile-journal-svod.ts`

### `codex/split-deep-1030c`

- `docs/audits/night-1030/SUMMARY-1030.md`
- `docs/audits/night-1030/split-600.json`
- `docs/audits/night-1030/split-600.md`
- `src/components/piling/admin-dictionaries-panels.tsx`
- `src/components/piling/admin-dictionaries-support.ts`
- `src/components/piling/admin-dictionaries-view.tsx`
- `src/components/piling/admin-dictionaries.tsx`
- `src/components/piling/admin-reports/admin-reports.tsx`
- `src/components/piling/admin-reports/report-list-controls.tsx`
- `src/components/piling/admin-sites/index.tsx`
- `src/components/piling/admin-sites/site-detail.tsx`
- `src/components/piling/to/readiness/screens/briefings-screen-format.tsx`
- `src/components/piling/to/readiness/screens/briefings-screen.tsx`
- `src/components/piling/to/readiness/screens/readiness-centre-equipment-card.tsx`
- `src/components/piling/to/readiness/screens/readiness-centre-handover-panel.tsx`
- `src/components/piling/to/readiness/screens/readiness-centre-score-card.tsx`
- `src/components/piling/to/readiness/screens/readiness-centre.tsx`
- `src/components/piling/to/readiness/screens/reports-screen-period.ts`
- `src/components/piling/to/readiness/screens/reports-screen.tsx`
- `src/components/piling/to/readiness/screens/settings-workspace-config.ts`
- `src/components/piling/to/readiness/screens/settings-workspace.tsx`
- `src/components/piling/to/to-module-view.tsx`
- `src/components/piling/to/to-module.tsx`
- `src/components/piling/to/to-navigation.ts`
- `src/components/piling/to/to-readiness-map.ts`
- `src/components/piling/to/to-selected-equipment.ts`
- `src/components/piling/to/to-workspace-load.ts`
- `src/modules/reports/application/event-handlers-analytics.ts`
- `src/modules/reports/application/event-handlers.ts`

## Пересечения

- `pto-order` и `pto-acts-accepted`: `pile-journal-xlsx.fixture.ts`.
- `pto-order` и `pto-small`: тесты и реализации `pile-journal-form41`, `pile-journal-svod`.
- `pto-acts-accepted` и `pto-small`: пересечений по файлам нет.
- ПТО-ветки и `split-deep`: пересечений по файлам нет.

## mergeOrder

1. `claude/pto-order-1030b`
2. `claude/pto-acts-accepted-1030b`
3. `claude/pto-small-1030b`
4. `codex/split-deep-1030c`

Объединение выполняется только в `codex/production-readiness-candidate`, без изменения `main` и `origin/main`.

## Полнота по времени

Поиск `git log --all --since="2026-10-30T23:59:59+03:00"` нашёл восемь принятых source commits из спецификации и созданный для этого аудита docs commit `443b0fd0`. Других поздних source commits нет.

## Исключения

Не входят существующие untracked-файлы корня: `careful-walk.js`, `check-admin-exports.js`, `check-all-operators.js`, `check-operators-separate.js`, `check-operators.js`, `check-roles.js`, `explore.js`, `explore2.js`, `explore3.js`, `novice-walk.js`, `test-versions.js`, `walk-all.mjs`, `walk-crew.mjs`, `walk-crew2.mjs`, `walk-v1-ka.mjs`.

Docs commits ветки `codex/production-readiness-audit` также не входят в candidate: это отчётность, а не код приложения.
