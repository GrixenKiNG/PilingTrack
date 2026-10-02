# Inventory качества — воспроизводимый подсчёт

Родитель: **I09**, [STRATEGY-2026Q4.md](./STRATEGY-2026Q4.md). Задача **CX-H14** (`hermes-tasks/H14.md`).

Это **только подсчёт**: один воспроизводимый срез размеров кода и документов. Документ не
предлагает удалять или делить файлы. Размер больше 500 строк **не** означает, что файл unused
или его надо резать; замороженные области (варианты экрана машиниста, `operator-mobile`, сайт
ORION) из подсчёта не изымаются, но и не предлагаются к удалению.

## Срез

- Ветка: `hermes/q4-0926` (рабочая копия `wt-night`).
- HEAD: `92eff65b1ecf0386b30b73cc16e8836646de095c`.
- Дата прогона: **02.10.2026**.
- Исторический срез стратегии: `eada5e1f` (S1, S2 `da6b7077`), дата 02.10.2026.

## Метод

Инструменты: `rg` (файлы и поиск), `node` (подсчёт строк). Python и пакеты не используются,
новый scanner/скрипт в репозиторий не добавляется — все команды выполняются inline.

1. Список файлов:
   `rg --files src -g '*.ts' -g '*.tsx' -g '!src/generated/**'`
   (`rg` уважает `.gitignore`; `src/generated/postgres-client/` и так исключён правилом
   `.gitignore:96`, флаг исключения оставлен явно).
2. Физические строки, для каждого файла (Node, чтение UTF-8):

   ```js
   const s = text.trimEnd();
   const lines = s === "" ? 0 : s.split(/\r?\n/).length;
   ```

   Финальный перевод строки не добавляет строку; пустой (после `trimEnd`) файл даёт 0;
   CRLF и LF разбираются одним шаблоном `/\r?\n/`.
3. Классификация: **test** — путь оканчивается на `.test.ts`/`.test.tsx` **или** лежит под
   каталогом `__tests__/`; всё остальное — **production**.
   (Проверено: в `src/` все 306 test-файлов удовлетворяют обоим условиям сразу — под
   `__tests__/` не-`*.test.ts(x)` файлов нет, `*.spec.ts(x)` в `src/` нет.)
4. Порог «большой» — строго `> 500` физических строк.

## Результат на текущем срезе (HEAD `92eff65b`, 02.10.2026)

| Метрика | Всего | production | test |
|---|---:|---:|---:|
| Файлов `.ts(x)` (без `src/generated`) | 1249 | 943 | 306 |
| Физических строк | 177300 | 130918 | 46382 |
| Файлов >500 строк | 42 | 33 | 9 |

Примечания к методу:
- В области среза **нет** полностью пустых `.ts/.tsx` файлов (правило «пустой → 0»
  реализовано, но на этих данных не срабатывает ни на одном файле).
- В области среза **нет** файлов с CRLF: `rg`/git хранят LF, ни один файл не содержит `\r\n`.
  CRLF-разбор реализован в шаблоне `/\r?\n/`, но на текущем срезе не востребован.

## Файлы > 500 строк (42)

`PROD` / `TEST` — по классификации выше. Строки — по методу из раздела «Метод».

```
 1716 PROD src/components/piling/operator-mobile/v10/operator-v10-app.tsx
 1312 PROD src/components/piling/operator-v5/operator-v5-app.tsx
 1255 PROD src/components/piling/operator-v2/operator-shift-v2.tsx
 1217 TEST src/services/audit/__tests__/audit-service.test.ts
 1068 PROD src/components/piling/to/readiness/screens/readiness-centre.tsx
 1003 PROD src/components/piling/operator-mobile/operator-mobile-app.tsx
  985 PROD src/services/audit/audit-service.ts
  933 TEST src/components/piling/operator-mobile/__tests__/api.test.ts
  872 TEST src/app/api/__tests__/api-routes.test.ts
  799 PROD src/components/piling/to/to-module.tsx
  753 PROD src/components/piling/operator-mobile/api.ts
  749 PROD src/modules/operator-mobile/application/mobile-shift-query.ts
  733 TEST src/modules/reports/application/commands/__tests__/report-command-service.test.ts
  686 PROD src/components/piling/admin-dictionaries.tsx
  636 PROD src/services/reports/event-handlers.ts
  630 PROD src/components/piling/inspections/run-inspection.tsx
  603 PROD src/components/piling/operator-dashboard.tsx
  600 PROD src/components/piling/to/readiness/screens/settings-workspace.tsx
  589 TEST src/modules/crews/application/commands/__tests__/crew-command-service.test.ts
  587 TEST src/services/reports/__tests__/daily-summary.test.ts
  581 PROD src/components/piling/admin-sites/index.tsx
  581 PROD src/components/piling/to/readiness/screens/briefings-screen.tsx
  578 PROD src/modules/reports/application/queries/pile-passport.service.ts
  576 PROD src/components/piling/to/readiness-design-views.tsx
  572 PROD src/components/piling/to/readiness/screens/reports-screen.tsx
  568 TEST src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts
  566 PROD src/components/piling/operator-mobile/v7/operator-v7-app.tsx
  558 PROD src/modules/operator-mobile/domain/checklist-catalog.ts
  551 PROD src/modules/operator-mobile/application/commands/production.ts
  542 PROD src/components/piling/operator-mobile/v7/v7-screens.tsx
  541 TEST src/core/observability/__tests__/health-tracker.test.ts
  538 PROD src/components/piling/operator-mobile/screens/checklist-screen.tsx
  537 PROD src/components/piling/admin-analytics.tsx
  525 PROD src/components/piling/operator-mobile/screens/work-screen.tsx
  523 PROD src/components/piling/to/readiness/screens/safety-overview-screen.tsx
  521 PROD src/core/media/media-service.ts
  515 PROD src/lib/rate-limiter.ts
  513 PROD src/lib/types.ts
  510 TEST src/components/piling/operator-mobile/__tests__/operator-mobile-app.test.tsx
  506 PROD src/modules/inspections/application/commands/inspection-commands.ts
  505 PROD src/modules/equipment/application/queries/equipment-query.service.ts
  505 PROD src/components/piling/maintenance/work-order-detail.tsx
```

Значительная часть крупных файлов — замороженные варианты (`operator-mobile/**`,
`operator-v5`, `operator-v2`, `operator-dashboard.tsx`) и их тесты. Размер сам по себе
**не** повод удалять или делить: `src/lib/rate-limiter.ts` (515) входит в список
security-critical (менять нельзя), а крупные тесты — это покрытие, а не долг.

## Документы (датированные числа)

Метод: `git ls-tree -r --name-only <ref> -- <dir>` (состав включает `README`/`template`,
если они есть в каталоге).

| Каталог | HEAD `92eff65b` (02.10.2026) | Срез `eada5e1f` (02.10.2026) |
|---|---:|---:|
| `docs/audits/**` (все `.md`) | 108 | 90 |
| `docs/runbooks/*.md` | 15 | 14 |
| `docs/adr/*.md` | 20 | 20 |
| `docs/plans/**` | 33 | 33 |
| `docs/archive/**` | 49 | 49 |

- `docs/audits/**` = 106 файлов в `docs/audits/hermes-night/` + 2 верхнеуровневых
  (`codex-api-audit-2026-09.md`, `codex-security-review-2026-09-24.md`); всего 108 в HEAD
  против 90 на срезе стратегии (+18 новых ночных аудитов).
- `docs/runbooks/`: 15 файлов `001…015` (на срезе было 14 — добавлен `014`/`015`).
- `docs/adr/`: 20 файлов = 18 нумерованных (`0001…0008`, `0041…0050`) + `README.md` +
  `template.md`. **Состав подсчёта ADR включает `README`/`template`** — отсюда «20».
- Числа **90 audits / 14 runbooks / 20 ADR** из стратегии воспроизводятся точно на её срезе
  `eada5e1f` (02.10.2026); на текущем HEAD они выросли до 108 / 15 / 20.

## Сверка с историческим срезом

Исторические данные стратегии: **1230** файлов `.ts(x)` без generated, **41** файл >500
строк (32 production / 9 test). Пересчёт среза `eada5e1f` тем же методом из этого документа:

| Метрика | `eada5e1f` (история / пересчёт) | HEAD `92eff65b` |
|---|---:|---:|
| Файлов всего | 1230 | 1249 |
| production / test файлов | 939 / 291 | 943 / 306 |
| Строк всего | 173629 | 177300 |
| Файлов >500 | 41 (32 / 9) | 42 (33 / 9) |

Исторические top counts и их значения на текущей ветке:

| Файл | История (`eada5e1f`) | HEAD `92eff65b` |
|---|---:|---:|
| `operator-mobile/v10/operator-v10-app.tsx` | 1716 | 1716 |
| `operator-v5/operator-v5-app.tsx` | 1312 | 1312 |
| `operator-v2/operator-shift-v2.tsx` | 1255 | 1255 |
| `services/audit/__tests__/audit-service.test.ts` | 1217 | 1217 |
| `to/readiness/screens/readiness-centre.tsx` | 1068 | 1068 |
| `services/audit/audit-service.ts` | 985 | 985 |

**Вывод.** Все шесть top counts совпадают до единицы, а пересчёт среза `eada5e1f` даёт ровно
1230 / 41 (32 / 9) — значит метод идентичен историческому, и расхождения по общим числам
объясняются **датой ветки**, а не методом:

- +19 файлов `src/**` (943−939 = +4 production, 306−291 = +15 test) появились после `eada5e1f`;
- из них ровно **один** перешагнул порог 500 строк:
  `src/components/piling/maintenance/work-order-detail.tsx` (505) — отсюда 42 против 41;
  ни один из прежних 41 крупного файла не выпал из списка.

Исторические 1230 / 41 (32 / 9) изменявшейся ветке не навязываются.

## Проверка (реальные команды и exit)

Все команды выполнялись по отдельности, без пайпа через `tail`/`head`.

| Команда | exit | Результат |
|---|---:|---|
| `node --version` | 0 | v26.7.0 |
| `rg --version` | 0 | ripgrep 15.2.0 |
| `rg --files src -g '*.ts' -g '*.tsx' -g '!src/generated/**' \| node -e '<метод>'` | 0 | 1249 файлов; 177300 строк; >500: 42 (33 prod / 9 test) |
| пересчёт `eada5e1f` через `git ls-tree` + `git cat-file --batch` + `<метод>` | 0 | 1230 файлов; >500: 41 (32 / 9) |
| сверка наборов >500 (`eada5e1f` vs HEAD) | 0 | добавлен только `maintenance/work-order-detail.tsx` |
| `git ls-tree -r --name-only HEAD -- docs/audits` (и `docs/runbooks`, `docs/adr`) | 0 | 108 / 15 / 20 |
| `git diff --check` | 0 | whitespace-ошибок нет |

`tsc` / `eslint` / `vitest` для этого изменения не запускались: whitelist задачи — один
Markdown-документ, кода и тестов он не трогает (H14: «для документов искусственные тесты не
нужны»).

## Оставлено без изменения и риски

- Ничего, кроме `docs/strategy/quality-inventory.md`, не менялось; исходники не читались
  глубже, чем нужно для подсчёта.
- Новых scanner/скриптов и code-файлов не создано.
- Числа планов/архива из стратегии (32 / 47) на её срезе дают по этой команде 33 / 49 —
  небольшое расхождение состава подсчёта; на приёмку H14 (90 / 14 / 20) оно не влияет.
- Подсчёт — срез на 02.10.2026; после новых коммитов числа сдвинутся (см. раздел «Сверка»).
- Локальный подсчёт не доказывает ничего про production; это инвентарь ветки, не проверка
  эксплуатации.