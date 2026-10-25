# Задание 7: `operator-mobile-app.tsx` (1118 строк)

Сначала прочитать `00-common.md` и отчёт `REPORT-readiness-centre.md`. Ветка: `codex/split-operator-mobile-app`. Не начинать, пока задание 6 не принято Claude.

## Ожидание заранее

В файле 945 строк (116–1060) занимает **один компонент** `OperatorMobileApp` — основной рабочий экран оператора с очередью команд, перезагрузкой, переходами и обработкой отказов. Чистым переносом выносится около 140 строк. Ожидаемый итог — около 980 строк. Цель «≤ 500» **недостижима без правки логики**, добиваться её не нужно.

## Явное снятие запрета заморозки (только здесь)

`AGENTS.md` §1 запрещает трогать `src/components/piling/operator*/**`. **Для этого задания разрешено** менять один файл — `src/components/piling/operator-mobile/operator-mobile-app.tsx` — и создавать новые файлы рядом, в `src/components/piling/operator-mobile/`. Не менять: `api.ts`, `offline-queue*.ts(x)`, `screens/**`, `safety/**`, `step-bar.tsx`, `shift-next-step.ts`, `v10/**`, CSS, тесты, `src/app/(app)/operator/page.tsx`. Ничего не удалять.

Внешние потребители: страница и три теста (`operator-mobile-app`, `queue-flow`, `step-bar-flow`) берут `OperatorMobileApp`. Имя остаётся экспортируемым из прежнего файла.

## Что переносится

| Строки | Содержимое | Куда |
|---|---|---|
| 38–115 | `PHASE_STAGE`, `AUTH_REDIRECT_MS`, `AUTH_EXPIRED_NOTICE`, `STALE_SCREEN_NOTICE`, `STALE_AFTER_REJECT_NOTICE`, `QUIET_RELOAD_EVERY_MS`, типы `WorkTab`, `Detour` | `operator-mobile-config.ts` |
| 1061–1118 | `OperatorFrame`, `ShiftMissingScreen` | `operator-mobile-frame.tsx` |
| 116–1060 | `OperatorMobileApp` | **остаётся целиком** |

Внимание: `PHASE_STAGE` дублирует по смыслу `PHASE_STAGE` из `v10/operator-v10-app.tsx`. **Не объединять** — только назвать в отчёте. Строка `import './operator-type.css'` остаётся в основном файле.

## Порядок шагов

1. Базовая линия + `npx vitest run src/components/piling/operator-mobile` — записать passed/skipped/failed (часть тестов этого каталога может быть уже красной на базе — назвать файлы). Эталон вёрстки (для себя, без коммита): отрендерить `OperatorMobileApp` с заглушками из `operator-mobile-app.test.tsx` и `step-bar-flow.test.tsx` во всех фазах, которые строят тесты; сохранить `container.innerHTML`; после переноса сравнить.
2. Перенос 38–115 → config (коммит), затем 1061–1118 → frame (коммит). После каждого: `tsc`, `lint`, тесты каталога, `check-pure-move.cjs` (код 0).
3. Финальные проверки.

## Что не делать

- **Не трогать `OperatorMobileApp`.** Он держит очередь команд, повторную отправку, тихую перезагрузку каждые 15 с и выход по истёкшему входу: перенос любого куска меняет порядок эффектов и таймеров.
- Не менять тексты уведомлений и значения констант (`AUTH_REDIRECT_MS`, `QUIET_RELOAD_EVERY_MS`) — копировать дословно.
- В отчёте — отдельным пунктом перечислить 3–5 отделимых блоков тела компонента с числом нужных параметров, **не выделяя их**.

## Готово, когда

Критерии `00-common.md`; тесты каталога с теми же числами; эталон вёрстки совпал; размер указан честно.
