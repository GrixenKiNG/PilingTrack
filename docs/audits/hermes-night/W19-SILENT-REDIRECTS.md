# W19-SILENT-REDIRECTS: другие молчаливые переходы при отказе

Дата: 2026-10-07. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).
Только чтение: код не менялся, приложение не запускалось, БД не читалась.
Продолжение W11 (`W11-NO-ACCESS-SCREEN.md`) и правок W15/W17/W18 («Нет доступа»
вместо молчаливого перехода). Ищем ОСТАВШИЕСЯ места в `src/`, где при отказе в
праве или в роли человека молча уводят на другой экран. Замороженные области
(операторские экраны, ORION) и вход `/login` — вне оценки.

## Итог

- Рассмотрено **16** мест вне замороженных областей и входа, где навигация вызвана
  условием (роль/право/сессия): серверные гварды (`redirect`), клиентские гварды
  (`router.replace`), посадка и адреса-синонимы.
- Молчаливый отказ по РОЛИ/ПРАВУ — **4** места: **1 живое (не исправлено)** и
  **3 уже исправленных** правками W15/W17 (ведут на `/no-access`, причину видно).
- Сессионные переходы на `/login` (не отказ в праве, но тоже молчаливый уход) —
  **8** мест; все признаны корректными.
- Не-отказы (посадка по роли, адреса-синонимы, перенос чужой вкладки) — **4** места.
- Единственное живое — `src/app/(app)/(readiness-admin)/layout.tsx:14-15`: помощник
  (`ASSISTANT`), открыв `/admin/to` по ссылке/закладке, молча попадает на
  `/operator` — не на свой экран (`/assistant`) и без объяснения. Тот же класс
  дефекта, что чинили W15/W17, но в этой раскладке он пропущен.
- Топ-5:
  1. **важно** — `(readiness-admin)/layout.tsx:15` (`redirect(OPERATOR_HOME_ROUTE)`)
     для `ASSISTANT`: молчаливый переход, и цель — чужой экран.
  2. **важно** — несогласованность: соседняя раскладка `admin/layout.tsx:15` уже
     ведёт на `/no-access` (W17), а `(readiness-admin)` — на `/operator`; поведение
     отказа зависит от того, какая родительская раскладка выше.
  3. **мелочь** — тест `(readiness-admin)/__tests__/layout.test.tsx:51-56` ЗАКРЕПЛЯЕТ
     старое молчаливое поведение (`REDIRECT:/operator`); правка W15/W17 его не
     обновила, поэтому починка обязана править тест вместе с кодом.
  4. **мелочь** — e2e W18 (`e2e/qa-ac/no-access.spec.ts`) покрывает помощника лишь на
     `/admin/reports`, но не на `/admin/to`; живой класс дефекта не задет тестом.
  5. **мелочь** — `admin-only.tsx:22` стал третьим слоем того же отказа (серверный
     гвард уже ведёт на `/no-access`); дублирование может уводить раньше сервера.

## Методика

Повторяемо из корня worktree. Числа — по фактическому содержимому `src/`.

1. Все серверные редиректы: поиск `redirect\(` и слова `redirect` по `src/` →
   18 / 42 совпадения (включая комментарии и тесты). Живые вызовы — только в
   `src/app/page.tsx`, `src/app/(app)/**/layout.tsx`, `src/app/(app)/no-access/page.tsx`,
   `src/lib/require-page-ability.ts`, `src/app/operator/{tabs,module}/page.tsx`,
   `src/app/(app)/admin/{piles,incidents}/page.tsx`.
2. Клиентская навигация: поиск `router\.(replace|push)\(` → 39 совпадений;
   `location.href`/`location.replace`/`history.*` → 100. Проверял каждое на
   близость к `can(`, `role`, `ability`, `roleHomeRoute`.
3. Точки отказа по праву: `requirePageAbility(` (раскладки `admin/**` + `admin/page.tsx`,
   15 вызовов) и `can(`/`useAbility(`/`assertCan(` — поиск `can\(|ability|useAbility`.
4. Ролевые сравнения: поиск `role\s*(===|!==)` и `\.role\b` → 85 совпадений в `*.tsx`;
   разбирал только те, где рядом стоит навигация.
5. Родительские раскладки: `find src/app -name layout.tsx` → 20 файлов;
   разобраны `(app)/layout.tsx`, `admin/layout.tsx`, `(readiness-admin)/layout.tsx`,
   `(safety)/layout.tsx`, `(auth)/layout.tsx`.
6. Домашние маршруты: `src/lib/routes.ts:29-40` (`roleHomeRoute`),
   `OPERATOR_HOME_ROUTE='/operator'` (:15), `ASSISTANT_HOME_ROUTE='/assistant'` (:18).
7. Матрица прав: `src/services/auth/authorization-service.ts:62-160` (`abilityRoles`, `can`).
8. Клиентский гвард: `src/components/piling/admin-only.tsx:16-26`; использование —
   `admin/{dlq,users,telegram}/page.tsx`.
9. Обработка 403 на клиенте: поиск `403` по `src/` — везде показ сообщения
   (`lib/api.ts:113`, `admin-dashboard.tsx:142-145`), навигации по 403 НЕТ.
10. Сверка с прежними выводами: `W11-NO-ACCESS-SCREEN.md` (находки 1-4),
    `git show add1b955 e20363e4 6eef0edf` (что именно было исправлено W15/W17/W18),
    `e2e/qa-ac/no-access.spec.ts` (покрытие).

## Находки

| # | severity | файл:строка | условие | куда ведёт | видит причину | предложение |
|---|---|---|---|---|---|---|
| 1 | важно | `src/app/(app)/(readiness-admin)/layout.tsx:14-15` | `!ALLOWED.has(user.role)`, где `ALLOWED` (:5-7) = ADMIN, DISPATCHER, MECHANIC, OPERATOR, FOREMAN, SAFETY_ENGINEER → отсекается только `ASSISTANT` | `/operator` (`OPERATOR_HOME_ROUTE`, `routes.ts:15`) | **нет** | Заменить на `/no-access` (как W15/W17), сессию (`:12`) оставить `/login`. Заодно проверить, что `ASSISTANT` не должен попадать на `/operator` вообще |
| 2 | важно | `src/app/(app)/admin/layout.tsx:14-15` | роль вне `['ADMIN','DISPATCHER','FOREMAN','MECHANIC','SAFETY_ENGINEER']` (OPERATOR/ASSISTANT) | `/no-access` | **да** | Исправлено W17 — оставить |
| 3 | важно | `src/lib/require-page-ability.ts:22` | `!can(user, ability)` | `/no-access` | **да** | Исправлено W15 — оставить |
| 4 | мелочь | `src/components/piling/admin-only.tsx:22` | `role !== 'ADMIN'` | `/no-access` | **да** | Исправлено W17 — оставить; кандидат на снятие (W11 п.4), чтобы не уводил раньше серверного гварда |
| 5 | мелочь | `src/lib/require-page-ability.ts:21` | нет сессии (`!user`) | `/login` | н/д (вход) | Оставить |
| 6 | мелочь | `src/app/(app)/admin/layout.tsx:9` | нет сессии | `/login` | н/д | Оставить |
| 7 | мелочь | `src/app/(app)/(readiness-admin)/layout.tsx:12` | нет сессии | `/login` | н/д | Оставить |
| 8 | мелочь | `src/app/(app)/(safety)/layout.tsx:21` | нет сессии (ролевого гейта в модуле нет — открыт всем, `:8-17`) | `/login` | н/д | Оставить |
| 9 | мелочь | `src/app/(app)/no-access/page.tsx:27` | нет сессии при открытом отказе | `/login` | н/д | Оставить |
| 10 | мелочь | `src/app/(app)/layout.tsx:328` | probe = `anonymous` (явный ответ сервера) → `logout()` | `/login` | н/д | Оставить (при `unknown` сессию сохраняет — `:321-325`) |
| 11 | мелочь | `src/app/(app)/layout.tsx:351` | bootstrap завершён, `currentUser` пуст | `/login` | н/д | Оставить |
| 12 | мелочь | `src/app/page.tsx:15,20` | нет токена / токен невалиден | `/login` | н/д | Оставить |
| 13 | — | `src/app/page.tsx:23` | посадка по роли (не отказ) | `roleHomeRoute(role)` | н/д | Оставить |
| 14 | — | `src/app/(app)/admin/piles/page.tsx:12` | адрес-синоним раздела (не отказ) | `/admin/reports?view=piles` | н/д | Оставить |
| 15 | — | `src/app/(app)/admin/incidents/page.tsx:12` | адрес-синоним раздела (не отказ) | `/admin/safety?view=incidents` | н/д | Оставить |
| 16 | — | `src/components/piling/to/to-module.tsx:353` | раздел чужой поверхности в адресе (не отказ) | маршрут `surfaceOfView(...)` | н/д | Оставить (`location.replace`, чтобы не зациклить «назад») |
| — | — | `src/app/(auth)/login/page.tsx:15` | вход, исключён задачей | `roleHomeRoute(role)` | н/д | Вне задачи |

Пояснение к находке 1 (почему это дефект, а не «как задумано»):

- Комментарий в `src/components/piling/icons/role-navigation.ts:26-29` объясняет
  открытость `/admin/to` для ОПЕРАТОРА («по ссылке из уведомления человек попадёт
  куда звали») — это про OPERATOR, он в `ALLOWED`. Помощника там нет.
- `routes.ts:35-38` прямо говорит: помощник смену не ведёт, его место `/assistant`;
  «дорога к своим инструктажам нужна каждому» — но не через чужой экран смены.
- `roleHomeRoute('ASSISTANT')` = `/assistant`, а редирект ведёт на `/operator` —
  не на его домашний экран. Соседние раскладки после W17 ведут на `/no-access`.
- У `/operator` (замороженный, вне оценки) серверного ролевого гейта НЕТ
  (`src/app/(app)/operator/page.tsx` рендерит `OperatorMobileApp` без проверки
  роли) — поэтому «молчаливое уведение» кладёт помощника на чужой экран.

## Не проверено

- **Приложение не запускалось** (read-only, нет env/БД): поведение редиректов
  выведено из кода, браузером не подтверждено. Живой прогон не делался.
- **Открыт ли `/admin/to` помощнику по правам контура готовности** (bootstrap
  `readiness` может сузить вкладки) — не проверено: правка не в теме W19, но может
  влиять на «что именно увидит помощник, если раскладку не менять».
- **Есть ли у помощника ссылка/уведомление на `/admin/to`** кроме ручного ввода —
  не проверял (в `role-navigation.ts` ссылки на `/admin/to` у `ASSISTANT` нет,
  но уведомления и письма вне `src/`).
- **Реально ли срабатывает** `(readiness-admin)/layout.tsx` для других ролей-вне-списка
  в будущем (роль вне 7 известных) — вопрос гипотетический, сейчас отсекается ровно
  `ASSISTANT`.
- **Живыми пользователями роли не проверялись**: `ASSISTANT` в проде есть, но вход не
  воспроизводился (QA-сессии — `D:/PillingR/qa/.auth`).
- **E2E-прогон** `e2e/qa-ac/no-access.spec.ts` не запускался (нужен живой сервер с
  правками W15; в сборке из `main` `/no-access` отдаёт 404 — см. сообщение коммита W18).

## Приложение: замороженные операторские экраны (только перечень, без оценки)

Задача просит перечислить, не оценивать. Все совпадения — сессия→`/login` и
внутренняя навигация, отказов по РОЛИ/ПРАВУ здесь нет:

- `src/app/operator/tabs/page.tsx:12` → `/prototypes/operator-tabs/index.html`
- `src/app/operator/module/page.tsx:13` → `/prototypes/operator-module/index.html`
- `src/components/piling/operator-mobile/operator-mobile-app.tsx:231,337` → `/login`
- `src/components/piling/operator-mobile/assistant-app.tsx:82` → `/login`
- `src/components/piling/operator-mobile/screens/knowledge-screen.tsx:67` → `/login`
- `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:99,171` → `/login`
- `src/components/piling/operator-mobile/v7/history-v7-app.tsx:76` → `/login`
- `src/components/piling/operator-mobile/v7/assistant-v7-app.tsx:104` → `/login`
- `src/components/piling/operator-mobile/v7/safety-v7-app.tsx:90` → `/login`
- `src/components/piling/operator-mobile/v10/operator-v10-app.tsx:1441` → `/login`
- `router.push` (навигация, не отказ): `operator-mobile/v7/v7-screens.tsx:528,533,537`;
  `safety-v7-app.tsx:112,283`; `history-v7-app.tsx:125`; `assistant-v7-app.tsx:275`;
  `operator-dashboard.tsx:220,563,568` (путь отхода, `AGENTS.md` §4);
  `app/(app)/operator/v3/report/page.tsx:9`.

ORION (`src/app/orion/**`, `src/components/orion/**`) не разбирался — вне задачи.
Вход `/login` (`src/app/(auth)/login/page.tsx`, `(auth)/layout.tsx`) исключён задачей.
