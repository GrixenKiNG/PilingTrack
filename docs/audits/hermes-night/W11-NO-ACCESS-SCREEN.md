# W11-NO-ACCESS-SCREEN: молчаливый редирект вместо «нет доступа»

Дата: 2026-10-06. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).
Только чтение: код не менялся, приложение не запускалось, БД не читалась.
Источник повода — находка 4 отчёта `docs/audits/hermes-night/W1-ROLE-ROUTES.md:68`
и `D-20261006-NEW-2`. Замороженные области (операторские экраны, ORION) не разбирались.

## Итог

- Найдено **9** пунктов: критично **0**, важно **3**, мелочь **6**.
- Главное (находка 1): при отказе в праве страница не показывает отказ, а молча
  уводит на «домашний» экран роли — `src/lib/require-page-ability.ts:9`
  (`redirect(roleHomeRoute(user.role))`). Человек жмёт закладку/ссылку из письма и
  оказывается на другом экране без объяснения: выглядит как «страница исчезла».
- Тот же приём продублирован ещё в двух местах: родительская раскладка админки
  (`src/app/(app)/admin/layout.tsx:12-14`, выкидывает OPERATOR/ASSISTANT) и
  клиентский `AdminOnly` (`src/components/piling/admin-only.tsx:20-22`).
- Помощник `requirePageAbility` вызывается **15** раз: 14 раскладок разделов + одна
  страница `admin/page.tsx`. Права у всех разные; разбор — в таблице ниже.
- Риск открытия доступа — **нет**: предлагаемое изменение не трогает условие
  `can(user, ability)` и не ослабляет серверные проверки API (`withApi`/`assertCan`).
  Опасность обратного знака (случайный рендер `children` вместо экрана отказа) —
  в разделе «Риск».
- Топ-5:
  1. **важно** — молчаливый редирект на домашний маршрут вместо экрана отказа
     (`require-page-ability.ts:9`).
  2. **важно** — тот же приём в `admin/layout.tsx:12-14` (OPERATOR/ASSISTANT) —
     срабатывает раньше секционного гварда, поэтому экран отказа «наверху» тоже нужен.
  3. **важно** — диспетчер видит в «Настройках» ссылки на `/admin/users`
     (`workspace-settings.tsx:265,275,330`), а раздел требует `users.manage` (только
     ADMIN) → тихий выброс (`users/layout.tsx:4` + `require-page-ability.ts:9`).
  4. **мелочь** — `checklists/layout.tsx:4` пускает по `inspection.perform` (есть у
     OPERATOR), но `admin/layout.tsx:12` выкидывает OPERATOR раньше → ветка недостижима.
  5. **мелочь** — ни одного теста на `requirePageAbility`; экрана «нет доступа» в
     проекте нет вообще (есть только `src/app/not-found.tsx`).

## Методика

Повторяемо из корня worktree (`rg` без `-r` — MSYS подменяет шаблон; смотрел через
инструмент поиска по содержимому):

1. Точки вызова: поиск `requirePageAbility(` по `src/` → 15 файлов (14 `layout.tsx`
   разделов + `admin/page.tsx:6`). Поиск импорта `require-page-ability` — те же 15
   файлов, больше нигде.
2. Сам помощник: `src/lib/require-page-ability.ts:6-9` (`readPageSessionUser` →
   `redirect('/login')`; `can(...)` → `redirect(roleHomeRoute(user.role))`).
3. Сессия и роль: `src/lib/page-session.ts:40-74` (в сессии раскладки нет `actingAs` —
   гвард считает права по СОБСТВЕННОЙ роли), `src/lib/types.ts:74` (`resolveEffectiveRole`).
4. Матрица прав: `src/services/auth/authorization-service.ts:62-135` (`abilityRoles`),
   функция `can` (:158-160).
5. Домашние маршруты: `src/lib/routes.ts:29-40` (`roleHomeRoute`); тест
   `src/lib/__tests__/routes.test.ts`.
6. Родительские гейты: `src/app/(app)/admin/layout.tsx:9-14`,
   `src/app/(app)/(readiness-admin)/layout.tsx:11-16`, `src/app/(app)/(safety)/layout.tsx:20-23`.
7. Клиентский двойник: `src/components/piling/admin-only.tsx:18-25`; использование —
   `admin/{dlq,users,telegram}/page.tsx:4,8`.
8. Меню и ссылки: `src/components/piling/icons/role-navigation.ts:97-161`;
   `src/components/piling/workspace-settings.tsx:265,275,330`.
9. Образец оформления готового экрана: `src/app/not-found.tsx:8-27`.
10. Осведомлённость о том же классе дефекта: `docs/audits/hermes-night/R136-ops-shell-navigation.md:15,42`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как править |
|---|---|---|---|---|---|
| 1 | важно | `src/lib/require-page-ability.ts:9` | При `!can(user, ability)` помощник делает `redirect(roleHomeRoute(user.role))` — молчаливый переход на домашний экран роли вместо экрана отказа | Человек открывает адрес из закладки/письма (`/admin/settings`, `/admin/sites`, `/admin`, `/admin/analytics`…) и оказывается на совсем другом экране. Причина не названа; выглядит как «страница исчезла» или «я попал не туда». Ровно об этом `D-20261006-NEW-2` | Не редиректить при отказе в праве: вернуть из помощника элемент экрана «Раздел недоступен вашей роли» с кнопкой «На главную», а раскладка его рендерит вместо `children` (см. «Предложение») |
| 2 | важно | `src/app/(app)/admin/layout.tsx:12-14` | Тот же приём у родительской раскладки админки: роли вне `[ADMIN,DISPATCHER,FOREMAN,MECHANIC,SAFETY_ENGINEER]` (то есть OPERATOR и ASSISTANT) молча уводятся `redirect(roleHomeRoute(user.role))` | Этот гейт срабатывает РАНЬШЕ секционного: OPERATOR/ASSISTANT до `requirePageAbility` не доходят вовсе. Экран отказа «наверху» нужен и здесь, иначе отказ для этих двух ролей останется молчаливым | Заменить редирект на рендер того же экрана отказа (роль известна — `user.role`), сохранив `redirect('/login')` для отсутствия сессии |
| 3 | важно | `src/components/piling/workspace-settings.tsx:265,275,330`; `src/app/(app)/admin/users/layout.tsx:4`; `src/lib/require-page-ability.ts:9` | Диспетчер открывает «Настройки» (его пункт меню, `role-navigation.ts:154`) и видит ссылки «Управление ролями» / «Все роли и права доступа →» на `/admin/users`, но раздел требует `users.manage` (только ADMIN, `authorization-service.ts:83`) → тихий выброс на `/admin` | Ссылка обещает действие, которое система заведомо не выполнит; человек не понимает, почему его «выкинуло». Совпадает с находкой 4 отчёта R136 | Либо прятать ссылки по `useAbility('users.manage')` (клиент), либо (в рамках этой задачи) показать экран «Раздел недоступен вашей роли» вместо редиректа — тогда клик по ссылке даёт понятный отказ |
| 4 | мелочь | `src/components/piling/admin-only.tsx:20-22` | Второй (клиентский) молчаливый редирект: `router.replace('/admin')` для не-ADMIN. Оборачивает страницы `/admin/dlq`, `/admin/users`, `/admin/telegram` (`*/page.tsx:4,8`), у которых уже есть серверный гвард `dlq.manage`/`users.manage`/`telegram.manage` | Третий слой той же манеры. После перевода серверных гвардов на экран отказа этот клиентский гейт станет избыточным и будет уводить раньше сервера — поведение разъедется | Убрать `AdminOnly` из трёх страниц (серверная раскладка уже закрывает) — но только после того, как серверный гвард начнёт показывать экран; иначе не трогать |
| 5 | мелочь | `src/app/(app)/admin/checklists/layout.tsx:4` vs `src/app/(app)/admin/layout.tsx:12` | `inspection.perform` выдан и OPERATOR (`authorization-service.ts:120`), но `admin/layout.tsx:12` OPERATOR не пускает в раздел вообще → ветка права на `/admin/checklists` недостижима | Два гейта отвечают по-разному: секционный гвард «разрешает» оператора, родительский — нет. Это сбивает при чтении матрицы прав и при будущих правках | Не править в рамках этой задачи; зафиксировать как вопрос согласования двух гейтов (либо убрать OPERATOR из `inspection.perform`, либо пускать его в раздел) |
| 6 | мелочь | `src/lib/require-page-ability.ts:6-9` | На помощника нет ни одного теста: поиск `requirePageAbility` среди `*.test.ts*` даёт 0 совпадений | Поведение отказа (самое важное для UX) не зафиксировано; любая правка может незаметно вернуть редирект или, хуже, пропустить роль | Добавить одиночный тест (см. «Тесты»): сессия→/login, роль без права→отказ, роль с правом→пропуск |
| 7 | мелочь | `src/app/not-found.tsx:8-27` | В проекте есть аккуратный русский экран 404, но экрана «нет доступа» нет вообще (поиск `Раздел недоступен`/`нет доступа` по `src/components` и `src/app` — только прочие упоминания в текстах ошибок) | Нечего переиспользовать; отказ приходится либо городить заново, либо оставлять редирект | Сделать по образцу 404 отдельный компонент «Раздел недоступен вашей роли» с кнопкой «На главную» |
| 8 | мелочь | `src/lib/routes.ts:30-39`; `src/lib/require-page-ability.ts:9` | «Домашний» маршрут роли — причина, по которой MECHANIC от `/admin/settings` попадает на `/admin/to`, а FOREMAN на `/admin`; для человека это выглядит произвольным переходом | Усиливает находку 1: цель редиректа неочевидна, человек не понимает связи «место → другой экран» | Не менять `roleHomeRoute`; в экране отказа назвать словами, куда ведёт кнопка («На главную»), и указать, что раздел закрыт для роли |
| 9 | мелочь | 15 точек: `src/app/(app)/admin/{analytics,checklists,crews,dictionaries,dlq,equipment,incidents,maintenance,piles,reports,settings,sites,telegram,users}/layout.tsx:4` и `src/app/(app)/admin/page.tsx:6` | Правка «показывать отказ вместо редиректа» затрагивает все 15 точек (сигнатура помощника меняется) | Объём правки недооценить нельзя: 15 файлов + 1 новый компонент. Это и есть основная причина, почему задача «зоны безопасности» — риск задеть горячий путь | Менять сигнатуру `requirePageAbility` (возврат «отказ/ок») и править 15 вызывающих по одному шаблону; либо сохранить совместимость, добавив новую функцию рядом (см. «Предложение», вариант Б) |

### Таблица «страница — право — роли без права»

Вызовы `requirePageAbility`. «Роли без права» приведены для пяти ролей, реально
допускаемых в раздел админки (`admin/layout.tsx:12`): ADMIN, DISPATCHER, FOREMAN,
MECHANIC, SAFETY_ENGINEER. OPERATOR и ASSISTANT отсекаются родительской раскладкой
(находка 2) и до секционного гварда не доходят.

| Страница | Вызов | Право | Роли с правом (`authorization-service.ts`) | Роли без права → сегодня редирект на |
|---|---|---|---|---|
| `/admin` (дашборд) | `admin/page.tsx:6` | `analytics.read` | ADMIN, DISPATCHER, FOREMAN (:63) | MECHANIC, SAFETY_ENGINEER → `/admin/to` |
| `/admin/analytics` | `analytics/layout.tsx:4` | `analytics.read` | ADMIN, DISPATCHER, FOREMAN (:63) | MECHANIC, SAFETY_ENGINEER → `/admin/to` |
| `/admin/checklists` | `checklists/layout.tsx:4` | `inspection.perform` | ADMIN, DISPATCHER, OPERATOR, MECHANIC, SAFETY_ENGINEER (:120) | FOREMAN → `/admin` (OPERATOR отсечён выше — находка 5) |
| `/admin/crews` | `crews/layout.tsx:4` | `crews.read` | ADMIN, DISPATCHER, MECHANIC, FOREMAN, SAFETY_ENGINEER (:126) | никого из пяти (только OPERATOR/ASSISTANT) |
| `/admin/dictionaries` | `dictionaries/layout.tsx:4` | `dictionary.manage` | ADMIN (:129) | DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER → их домашний маршрут |
| `/admin/dlq` | `dlq/layout.tsx:4` | `dlq.manage` | ADMIN (:133) | DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER |
| `/admin/equipment` | `equipment/layout.tsx:4` | `equipment.read` | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER (:103) | FOREMAN → `/admin` |
| `/admin/incidents` | `incidents/layout.tsx:4` | `incidents.read` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (:112) | MECHANIC → `/admin/to` |
| `/admin/maintenance` | `maintenance/layout.tsx:4` | `maintenance.manage` | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER (:108) | FOREMAN → `/admin` |
| `/admin/piles` | `piles/layout.tsx:4` | `piles.manage` | ADMIN, DISPATCHER, FOREMAN (:71) | MECHANIC, SAFETY_ENGINEER → `/admin/to` |
| `/admin/reports` | `reports/layout.tsx:4` | `reports.read_all` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (:64) | MECHANIC → `/admin/to` |
| `/admin/settings` | `settings/layout.tsx:4` | `system.read` | ADMIN, DISPATCHER (:131) | FOREMAN → `/admin`; MECHANIC, SAFETY_ENGINEER → `/admin/to` |
| `/admin/sites` | `sites/layout.tsx:4` | `sites.read_all` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (:72) | MECHANIC → `/admin/to` |
| `/admin/telegram` | `telegram/layout.tsx:4` | `telegram.manage` | ADMIN (:130) | DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER |
| `/admin/users` | `users/layout.tsx:4` | `users.manage` | ADMIN (:83) | DISPATCHER, FOREMAN, MECHANIC, SAFETY_ENGINEER |

Итого: молчаливый отказ достижим для каждой из пяти «офисных» ролей хотя бы на одном
разделе; чаще всего от этого страдают MECHANIC (7 разделов) и SAFETY_ENGINEER (6).

## Предложение: экран «Раздел недоступен вашей роли»

Правки только в четырёх местах по смыслу (но 15 файлов механически). Логику допуска
(`can`, `abilityRoles`) и серверные проверки API не трогаем.

### Что менять

1. **Новый компонент** `src/components/piling/section-unavailable.tsx` — по образцу
   `src/app/not-found.tsx:8-27`:
   - заголовок «Раздел недоступен вашей роли»;
   - пояснение: «Этот раздел открыт другим ролям. Вернитесь на свой рабочий экран.»;
   - кнопка/ссылка «На главную» → пробрасывается `home` (результат `roleHomeRoute`),
     чтобы цель считалась на сервере по настоящей роли;
   - опционально вторая строка с названием раздела (передать `sectionLabel` из
     раскладки) — но НЕ техническое имя права.
   Рендерится внутри общей оболочки `(app)/layout.tsx`, поэтому меню и ролевая
   плашка остаются видимыми.

2. **`src/lib/require-page-ability.ts`** — не редиректить при отказе в праве, а
   возвращать «отказ». Два варианта:

   Вариант А (рекомендуемый, минимальный по смыслу):
   ```
   export async function requirePageAbility(ability: Ability) {
     const user = await readPageSessionUser();
     if (!user) redirect('/login');                 // сессия — по-прежнему редирект
     if (!can(user, ability)) {
       return <SectionUnavailable home={roleHomeRoute(user.role)} />;
     }
     return null;
   }
   ```
   Раскладка (шаблон на всех 15 точках):
   ```
   const denied = await requirePageAbility('system.read');
   if (denied) return denied;      // ВАЖНО: return, а не «||»
   return <>{children}</>;
   ```

   Вариант Б (если не хочется возвращать JSX из утилиты): помощник возвращает
   `{ denied: true, home } | null`, а раскладка сама рендерит `<SectionUnavailable .../>`.
   Тогда утилита остаётся «чистой», но шаблон в 15 файлах чуть длиннее.

3. **`src/app/(app)/admin/layout.tsx:12-14`** — для OPERATOR/ASSISTANT тоже вернуть
   экран отказа вместо `redirect(roleHomeRoute(...))` (иначе для этих двух ролей
   поведение не изменится — их отсекает именно этот гейт).

4. **Три страницы `admin/{dlq,users,telegram}/page.tsx`** — клиентский `AdminOnly`
   (`admin-only.tsx:20-22`) станет лишним и будет уводить раньше сервера; убрать его
   обёртку можно только ПОСЛЕ того, как серверный гвард начнёт показывать экран.
   Если сомневаетесь — оставить `AdminOnly` как есть (он ничего не ломает, лишь
   дублирует), но тогда поведение «Настройки → Управление ролями» для диспетчера
   останется молчаливым (находка 3).

Объём: 1 новый компонент + правка `require-page-ability.ts` + `admin/layout.tsx` +
14 раскладок разделов (+ опционально 3 страницы).

### Какие тесты нужны

- **Одиночный** `src/lib/__tests__/require-page-ability.test.ts` (рядом с кодом, §5):
  - нет сессии → `redirect` вызван с `/login`;
  - роль без права → редиректа на домашний маршрут НЕТ, вернулся отказ;
  - роль с правом → `null` (пропуск), `redirect` не вызван;
  - гвард считает права по СОБСТВЕННОЙ роли: `can` получает `{role}` без `actingAs`
    (в `page-session.ts` `actingAs` вообще нет) — зафиксировать это поведение.
  Мокать `readPageSessionUser` и `next/navigation` (`redirect`).
- **Компонентный** `src/components/piling/__tests__/section-unavailable.test.tsx`:
  виден текст «Раздел недоступен вашей роли», есть ссылка «На главную» с `href`,
  и НЕТ контента раздела.
- **e2e** (Playwright, §5 — один спек достаточно): вход MECHANIC → прямой `goto`
  `/admin/settings` → виден экран отказа и кнопка «На главную», автоматического
  перехода на `/admin/to` нет; клик по кнопке ведёт на `roleHomeRoute('MECHANIC')`.
  Учесть, что нужны QA-аккаунты (`qa-mechanic@…`, см. `e2e/qa/helpers`).
- **Регресс на утечку:** на экране отказа не должно отрисоваться содержимое раздела
  (проверить отсутствие характерного текста страницы) — это защита от «отказ, но
  `children` всё равно где-то отрендерился».

## Риск: не откроет ли изменение доступ, который сейчас закрыт

Коротко: **новый доступ не открывается.** Разбор:

- Условие допуска остаётся прежним — `can(user, ability)` по `abilityRoles`
  (`authorization-service.ts:158-160,62-135`). Меняется только реакция на отказ
  (экран вместо редиректа), а не сам допуск.
- Серверные API проверяют права независимо от раскладки: `withApi`/`assertCan` и
  сужение по бригадам отдают 403 и `{"error":"Доступ запрещён"}`
  (`authorization-service.ts:162-166`; примеры — R99, R97). Даже если бы человек
  остался на URL раздела, данные он не получит.
- Ветка «нет сессии» ОСТАЁТСЯ редиректом на `/login` — экран отказа не должен
  рендериться для неаутентифицированного (иначе оболочка `(app)/layout.tsx` покажет
  каркас без сессии).

Риски изменения (в порядке важности):

1. **Ошибочный рендер `children`.** Если раскладку написать как
   `return <>{denied ? denied : null}{children}</>` — содержимое раздела отрисуется
   рядом с экраном отказа. Это единственный реальный способ «открыть» закрытое.
   Обязательный шаблон — ранний `return denied;` ДО `{children}`. Покрывается
   регресс-тестом на утечку (см. выше).
2. **Исполнение серверных компонентов страницы при «непустом» layout.** Не проверено
   (приложение не запускалось): в App Router дочерние серверные компоненты могут
   вычисляться независимо от того, что раскладка их не рендерит. Если так — на экране
   отказа может отработать запрос страницы. Утечки данных нет (API 403), но стоит
   проверить живым запуском; вывод занесён в «Не проверено».
3. **URL остаётся на адресе раздела.** Человек по-прежнему в адресной строке видит
   `/admin/settings` и подсвеченный пункт меню — это ожидаемо и предпочтительнее
   «пропажи» страницы, но владельцу стоит подтвердить, что такой вариант желателен
   (в отличие от `404`-подобного ухода).
4. **Смена точки «посадки» для `/admin`.** Сейчас MECHANIC/SAFETY_ENGINEER на `/admin`
   молча попадают на `/admin/to`. После правки они увидят экран отказа с кнопкой.
   Поскольку вход и корневой редирект ведут сразу на `roleHomeRoute`
   (`login/page.tsx:15`, `app/page.tsx:23`), на `/admin` эти роли штатно не попадают —
   поведение входа не меняется.
5. **`AdminOnly` как третий гейт.** Если убрать его до правки серверного гварда,
   `/admin/dlq|users|telegram` останутся без клиентской подстраховки (серверный гвард
   и так закрывает, но это ужесточение, а не расширение). Безопасный порядок: сначала
   серверный экран, потом (при желании) снятие `AdminOnly`.

Вывод по риску: **расширения доступа нет при условии раннего `return` в раскладках.**
Остальное — UX и согласованность двух-трёх гейтов.

## Не проверено

- **Приложение не запускалось**: сборка/тесты/запросы не выполнялись (задача read-only,
  сборка требует env и БД). Всё поведение редиректов выведено из кода, а не из браузера.
- **Вычисляются ли серверные компоненты страницы при «непустом» layout** в App Router
  Next.js 16 — не проверено; от этого зависит, отработают ли запросы страницы под
  экраном отказа (утечки данных не будет из-за API-гвардов, но факт — открыт).
- **Точный текст/вид экрана отказа** не согласован с владельцем: названия раздела,
  формулировка причины («раздел открыт другим ролям» vs «нет права»), нужна ли
  отдельная строка про режим «Действую как».
- **Нужно ли чинить находку 3** (ссылки диспетчера на `/admin/users`) правкой
  `workspace-settings.tsx` или достаточно экрана отказа — не решено; зависит от решения
  владельца.
- **Живыми пользователями роли не проверялись**: MECHANIC/FOREMAN/SAFETY_ENGINEER в
  проде без людей (AGENTS.md §3); QA-аккаунты есть, но вход не воспроизводился.
- **Согласование `inspection.perform` (OPERATOR) с гейтом `admin/layout.tsx`** (находка 5)
  не разбиралось по существу: неясно, задумано ли, что оператор формально имеет право
  на `/admin/checklists`, но в раздел не допускается.
- **Влияние на «Действую как»**: гвард раскладки считается по собственной роли
  (`page-session.ts` не возвращает `actingAs`), поэтому админ «в роли OPERATOR» проходит
  гвард, а API затем 403. Как этот случай должен выглядеть на новом экране отказа —
  не проработано (известный отдельный класс, см. R99 находка 5).
