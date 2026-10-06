# W34 — Следы старых молчаливых переходов после W15/W17/W22

READ-ONLY. Ни один существующий файл не изменён. Ветка `hermes/q4-0926`, коммит на момент разбора — `18790655`.

## Итог

Проверено четыре пункта задания и попутно ещё два следа миграции. Живого мёртвого кода — мало, и почти всё намеренное.

- **критично: 0**
- **важно: 1** — устаревший e2e `e2e/role-audit.spec.js` закрепляет СТАРЫЕ переходы: домашний экран инженера ОТ `/admin/to` (сейчас `/admin/safety`) и молчаливый увод не-админа с `/admin/users` на домашний экран (сейчас `/no-access`). Он собирается Playwright (входит в 270 тестов) и противоречит актуальному тесту `e2e/qa-ac/no-access.spec.ts`.
- **мелочь: 3** — (1) параметр `from` на `/no-access` читается и печатается, но его не проставляет НИ ОДИН вызов (подтверждено W25); (2) компонента `section-unavailable.tsx` в ветке НЕТ — он остался только предложением в отчёте W11, живой отказ реализован прямо в `no-access/page.tsx`; (3) `appPageRoute`/`PAGE_TO_ROUTE` в `routes.ts` (наследие SPA-роутинга) используется ровно в одном месте из 14.

Неиспользуемых импортов `roleHomeRoute`, `OPERATOR_HOME_ROUTE`, `redirect` в раскладках НЕТ — это подтверждено линтом (368 файлов, 0 предупреждений).

Пять главных пунктов: устаревший `role-audit.spec.js` (важно); мёртвая ветка `from`; отсутствующий `section-unavailable`; мёртвые записи `PAGE_TO_ROUTE`; вердикт «оставить» по редиректам-заглушкам `admin/incidents` и `admin/piles`.

## Методика

Поиск текстом (`git grep` по всему репозиторию, включая `src/`, `e2e/`, `tests/`, `scripts/`, `prisma/`, конфиги):

```bash
git grep -n "roleHomeRoute" -- .
git grep -n "OPERATOR_HOME_ROUTE" -- .
git grep -n "section-unavailable" -- .          # и SectionUnavailable отдельно
git grep -n "REDIRECT:" -- .
git grep -n "no-access" -- .                     # и отдельно "no-access?" (кто строит URL с from)
git grep -n "redirect(" -- src
git grep -n "router.replace(" -- src
git grep -n "appPageRoute" -- .
git grep -n "users.manage" -- src/services/auth/authorization-service.ts
find src/app -name "layout.tsx"
```

История строк (когда символ менялся), чтобы понять «следы»:

```bash
git log --oneline -S "REDIRECT:/operator" -- src e2e
git log --oneline -S "REDIRECT:/admin/safety" -- src e2e
git log --all --oneline -- '*section-unavailable*'
```

Линт (оба варианта запущены раздельно, exit-код снят напрямую, без пайпа в tail/head):

```bash
npx eslint src/app src/lib        # exit 0
npx eslint src/app src/lib -f json > "$TMPDIR/eslint.json"   # файлов: 368, сообщений: 0
npm run lint                      # exit 0 (eslint . + check-text-integrity.js), предупреждений нет
```

Проверка собираемости e2e/юнитов (без запуска, нужны env/БД):

```bash
npx playwright test --list        # 270 тестов в 26 файлах; role-audit.spec.js присутствует
```

«Удалять нельзя — только список»: каждый вывод «мёртвое / устаревшее» ниже подтверждён ссылками `path:line`, открытыми в ходе разбора. Ни один импорт/экспорт не удалён.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предложение |
|---|---|---|---|---|---|
| 1 | важно | `e2e/role-audit.spec.js:6`; `:25`; `:30` | Устаревший e2e закрепляет СТАРЫЕ переходы. Строка 6: `SAFETY_ENGINEER:'/admin/to'` — а `roleHomeRoute('SAFETY_ENGINEER')` теперь `'/admin/safety'` (`src/lib/routes.ts:34`, зафиксировано `src/lib/__tests__/routes.test.ts:8`). Строка 25 после входа ждёт URL = `home`; строка 30 после `goto('/admin/users')` для не-админа ждёт возврат на `home` — но `/admin/users` закрыт правом `users.manage` только для ADMIN (`src/services/auth/authorization-service.ts:83`) и гвард раздела уводит на `/no-access` (`src/lib/require-page-ability.ts:22`) | Тест собирается Playwright (входит в 270) и противоречит актуальному `e2e/qa-ac/no-access.spec.ts:36-44` (N1: диспетчер на `/admin/users` → `/no-access`). Для инженера ОТ он падает уже на входе (ждёт `/admin/to`, а приложение ведёт на `/admin/safety`). Это ровно след старого молчаливого перехода, не обновлённый после W15/W17/W22 | Обновить или удалить `e2e/role-audit.spec.js`: `SAFETY_ENGINEER:'/admin/safety'`; строку 30 переписать на ожидание `/no-access` (как в `no-access.spec.ts`). Правку делать отдельной задачей — здесь только найден след |
| 2 | мелочь | `src/app/(app)/no-access/page.tsx:24,29,40-42` | Параметр `from` читается из `searchParams` и печатается как текст, но URL `/no-access?from=...` не строит НИ ОДИН вызов приложения. Все три точки входа делают голый `redirect('/no-access')`: `src/lib/require-page-ability.ts:22`, `src/app/(app)/admin/layout.tsx:15`, `src/app/(app)/(readiness-admin)/layout.tsx:17`, плюс клиентский `src/components/piling/admin-only.tsx:22` | Блок «Запрошенный адрес: …» (`:41`) никогда не показывается живому пользователю — единственный, кто проставляет `from`, это сам e2e (`e2e/qa-ac/no-access.spec.ts:79`). Заявленная в комментарии `page.tsx:18-19` ценность не работает (подтверждает W25, `docs/audits/hermes-night/W25-BRANCH-SECURITY-REVIEW.md:63`) | Развилка: либо проставлять реальный путь (`redirect('/no-access?from=' + encodeURIComponent(path))` в гварде), либо убрать параметр и блок. **Перед удалением** помнить, что ветку закрепляют `src/app/(app)/no-access/__tests__/page.test.tsx:38-43` и `e2e/qa-ac/no-access.spec.ts:73-83` — их придётся снять вместе с параметром |
| 3 | мелочь | `docs/audits/hermes-night/W11-NO-ACCESS-SCREEN.md:111,131,170` (только документ) | Компонента `src/components/piling/section-unavailable.tsx` в ветке НЕТ: `ls` — файл отсутствует, `git log --all -- '*section-unavailable*'` — пусто, `git grep 'section-unavailable\|SectionUnavailable'` по `src/ e2e/ tests/ scripts/` — совпадений нет. Имя встречается только в отчёте W11 как предложение | Раздел «Не проверено» W11 описывал общий компонент `<SectionUnavailable home=… />`; по факту отказ реализован инлайном прямо в `src/app/(app)/no-access/page.tsx:32-50`, а `requirePageAbility` делает `redirect('/no-access')`. Мёртвого кода нет — есть только устаревшая ссылка в документе | Ничего не удалять. При желании — пометка в W11, что компонент не появился (отдельной задачей) |
| 4 | мелочь | `src/lib/routes.ts:42-60` | `PAGE_TO_ROUTE` (14 записей) и функция `appPageRoute` — наследие SPA-роутинга (комментарий `routes.ts:1-4`). `appPageRoute` вызывается ровно один раз: `src/components/piling/equipment-analytics.tsx:181` (`appPageRoute('admin-equipment')`). Остальные 13 записей карты в живом коде не используются | 13 из 14 записей — мёртвая карта; рядом перечислены маршруты (`'/operator'`, `'/admin/...'`), которые и так собраны по-другому. Это след старой навигации, но карта типизирована (`Record<AppPage,string>`) и связана с `AppPage` в `src/lib/store.ts:29,61,115` | Не трогать без отдельной задачи: связь с `AppPage`/стором шире одной функции. Достаточно зафиксировать как след |

## Явно оставлено (не мёртвое, удалять нельзя)

- `src/app/(app)/admin/incidents/page.tsx:12` → `redirect('/admin/safety?view=incidents')` и `src/app/(app)/admin/piles/page.tsx:12` → `redirect('/admin/reports?view=piles')` — осознанные редиректы-заглушки для старых закладок, с объяснением в шапке файлов (`incidents/page.tsx:3-9`, `piles/page.tsx:3-9`). Это не след, а спроектированное поведение. Замечание из доклада 18 (`docs/audits/hermes-night/18-ui-vs-api-permissions.md:134`): цель `piles` (`/admin/reports?view=piles`) под правом может не открыться у роли без `reports.read_all` — это отдельный UX-вопрос, не мёртвый код.
- `src/app/operator/module/page.tsx:13` и `src/app/operator/tabs/page.tsx:12` (редиректы на `prototypes/...`) — зона `src/app/operator/**` заморожена (AGENTS §1) и не рассматривалась.
- `roleHomeRoute`, `OPERATOR_HOME_ROUTE`, `ASSISTANT_HOME_ROUTE` (`src/lib/routes.ts:15-40`) — все живые: `page.tsx:23`, `login/page.tsx:15`, `no-access/page.tsx:44`, `role-navigation.ts:34,55`. Удалять нечего.
- `redirect` в раскладках — импортирован ровно там, где используется: `(readiness-admin)/layout.tsx:1` используется в `:11,17`; `(safety)/layout.tsx:1` — `:21`; `admin/layout.tsx:1` — `:9,15`. Неиспользуемых импортов нет.

## Не проверено

- **e2e/юнит-тесты не запускались живьём** — нужны `.env`, БД и dev-сервер (AGENTS §6, §5; vitest не читает `.env`). Прогон не выполнялся: только `npx playwright test --list` (270 тестов, `role-audit.spec.js` в списке). Поэтому вывод по находке №1 — статический (сверка ассертов с кодом), а не «тест упал на прогоне».
- **Падение `role-audit.spec.js` в браузере не воспроизведено** (некому запустить против живого стенда). Утверждение «строка 25/30 не совпадёт с фактом» выведено из кода (`routes.ts:34`, `require-page-ability.ts:22`, `authorization-service.ts:83`), а не из прогона.
- **`ASSISTANT` в списке `ALLOWED`** (`(readiness-admin)/layout.tsx:4-6`) не проверялся на соответствие карте прав — вне задачи W34.
- Проверка шла по ветке `hermes/q4-0926` (44 коммита впереди/67 позади `origin/main`); состояние `origin/main` не сверялось.
