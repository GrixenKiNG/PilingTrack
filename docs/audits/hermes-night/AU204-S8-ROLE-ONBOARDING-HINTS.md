# AU204-S8-ROLE-ONBOARDING-HINTS — Первые шаги для каждой роли

Версия кода: `git rev-parse HEAD` = `b49592ba5b04f7f84b44fcb1608b8468180f837e` (ветка `hermes/q4-0926`).
Только чтение: код приложения не изменялся. Создан один файл — этот отчёт.

## Итог

- Ролей в системе семь (`src/lib/types.ts:5`). Куда каждая попадает после входа, решает одна функция `roleHomeRoute` — `src/lib/routes.ts:29`.
- Подсказка первого действия есть у четырёх ролей из семи: АДМИН/ДИСПЕТЧЕР/МАСТЕР (`/admin`), МЕХАНИК (`/admin/to`), ОПЕРАТОР (`/operator`), ПОМОЩНИК (`/assistant`).
- У ИНЖЕНЕРА ОТ своего первого шага нет: домашний `/admin/safety` открывается на «Обзор» без онбординга — только прочерки KPI и «Записей пока нет».
- «Первого входа» как понятия в коде нет вовсе: поиск `hasSeen|firstLogin|onboarded|welcomeShown|showTour` по `src/` не дал ни одного совпадения. Все подсказки — реакция на ПУСТЫЕ данные, а не на нового человека.
- Главная находка: блок «С чего начать» у админа (`src/components/piling/admin-dashboard.tsx:454`) включается только когда в системе нет ни объекта, ни техники (`:324`); как только появился один объект — подсказка исчезает, даже если бригад и пользователей ещё нет.

Счёт по важности: критично — 0, важно — 3, мелочь — 5.

Топ-5:
1. Нет понятия «первый вход» — онбординг зависит от пустоты БД, не от новизны пользователя (вход — `src/app/page.tsx:10`, `src/app/(auth)/login/page.tsx:9`).
2. Блок «С чего начать» гаснет при появлении первого объекта/техники — `src/components/piling/admin-dashboard.tsx:324`.
3. Шаги онбординга не фильтруются правами: у ДИСПЕТЧЕРА пункты «Справочники» и «Пользователи» ведут в закрытые разделы — `src/components/piling/admin-dashboard.tsx:58`, `src/lib/require-page-ability.ts:19`.
4. У ИНЖЕНЕРА ОТ нет первого действия на домашнем экране — `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:141`.
5. На ПЕРВОМ экране оператора две кнопки про одно: футер экрана «Проверить средства защиты» (`identity-screen.tsx:43`) и панель «Следующий шаг» (`step-bar.tsx:113`) стоят друг под другом (`ui.tsx:68`).

## Методика

Что искал и как (все пути — от корня `D:\PillingR\wt-night`):

1. Точки входа роли: `src/lib/routes.ts` (функция `roleHomeRoute`), `src/app/page.tsx` (корневой редирект), `src/app/(auth)/login/page.tsx` (послевходный), `src/app/(app)/layout.tsx` (оболочка и меню).
2. Меню по ролям: `src/components/piling/icons/role-navigation.ts`.
3. Домашние экраны: `src/app/(app)/admin/page.tsx`, `src/app/(app)/(readiness-admin)/admin/to/page.tsx`, `src/app/(app)/(safety)/admin/safety/page.tsx`, `src/app/(app)/operator/page.tsx`, `src/app/(app)/assistant/page.tsx`, `src/app/operator/page.tsx`.
4. Поиск онбординга/подсказок текстом:
   - `rg -n -i "добро пожаловать|onboard|первый вход|первых шаг|с чего начать|пусто|нет данных|пока нет|нет записей|ещё нет" src/`
   - `rg -n -i "welcome|empty|placeholder|hint|guide|tour|onboarding" src/components src/app`
   - `rg -c -i "с чего начать|следующий шаг|что делать сейчас"` — по файлам экранов.
5. Поиск признака «первого входа»: `rg -n -i "hasSeen|firstLogin|onboarded|welcomeShown|showTour|tourShown" src/` → exit 1, совпадений нет. Дополнительно `rg -n "lastLoginAt" src/` — дата входа только пишется и показывается в карточке пользователя (`src/components/piling/admin-users/user-detail.tsx:132`), из неё ничего не решается.
6. Гварды разделов (куда ведёт пункт без права): `src/lib/require-page-ability.ts:19`, `src/app/(app)/no-access/page.tsx:15`, `src/lib/__tests__/page-ability-layouts.test.ts:62`.
7. Пустые состояния: `src/components/piling/admin-dashboard-bits.tsx:234` (компонент `Empty`), `src/components/piling/admin-dashboard.tsx` (условия показа), `src/components/piling/to/readiness/screens/readiness-centre.tsx:612`, `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:141`.
8. Нижняя панель «Следующий шаг»: `src/components/piling/operator-mobile/shift-next-step.ts:77`, `src/components/piling/operator-mobile/step-bar.tsx:47`, `src/components/piling/operator-mobile/ui.tsx:48`.

Команды проверки (для повторного прогона) — точечные `rg`, приведены выше; ничего не менялось, поэтому §6 AGENTS.md (tsc/lint/test/build) не запускался.

Статусы: ПРОЙДЕНО — вывод подтверждён чтением конкретного файла; ГИПОТЕЗА — вывод сделан по косвенным признакам (например, по составу меню), без чтения `src/services/auth/authorization-service.ts`; НЕ ПРОВЕРЕНО — не проверял.

## Что видит каждая роль при первом входе

| Роль | Экран входа | Файл:строка | Подсказка первого действия | Статус |
|---|---|---|---|---|
| ADMIN | Дашборд `/admin` | `src/lib/routes.ts:30`, `src/app/(app)/admin/page.tsx:5` | Есть блок «С чего начать» со списком 5 разделов по порядку — `src/components/piling/admin-dashboard.tsx:454`; показывается только при пустой БД (`:324`) | ПРОЙДЕНО |
| DISPATCHER | Дашборд `/admin` | `src/lib/routes.ts:30` | Тот же блок, но пункты «Справочники» и «Пользователи» ведут в разделы, которых в его меню нет — `src/components/piling/admin-dashboard.tsx:59-62`, `src/components/piling/icons/role-navigation.ts:80` | ГИПОТЕЗА |
| FOREMAN (Мастер) | Дашборд `/admin` | `src/lib/routes.ts:30` | Тот же блок; пункт «Установки» (`admin-dashboard.tsx:61`) — в тупик, карточка установки мастеру закрыта (`admin-dashboard.tsx:92`) | ГИПОТЕЗА |
| MECHANIC | «Центр готовности» `/admin/to` | `src/app/(app)/(readiness-admin)/admin/to/page.tsx:3` | Лента «Что делать сейчас: Механик» с шагами, пилюлями «Выполнено/Нет данных/Сейчас/Впереди» и подписью «Сделайте это сейчас» — `src/components/piling/to/readiness/screens/readiness-centre.tsx:41`, `:203`, `:281` | ПРОЙДЕНО |
| SAFETY_ENGINEER | Обзор «ТБ и допуски» `/admin/safety` | `src/app/(app)/(safety)/admin/safety/page.tsx:12`, `src/components/piling/to/to-module.tsx:165` | Нет первого действия: пустая база = прочерки «—» и «Записей пока нет» — `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:226`, `:478` | ПРОЙДЕНО |
| OPERATOR | «Допуск к работе» `/operator` | `src/app/(app)/operator/page.tsx:20`, `src/components/piling/operator-mobile/operator-mobile-app.tsx:913` | Экран допуска с пошаговыми панелями (СИЗ → инструкция → проверка знаний) и кнопка «Проверить средства защиты» — `src/components/piling/operator-mobile/screens/identity-screen.tsx:31-37`; плюс постоянная панель «Следующий шаг» — `src/components/piling/operator-mobile/step-bar.tsx:113` | ПРОЙДЕНО |
| ASSISTANT | «Помощник машиниста» `/assistant` | `src/app/(app)/assistant/page.tsx:12` | Панель «Допуск неполный» со списком недостающего и большие кнопки «Пройти инструктаж» / «Пройти проверку» — `src/components/piling/operator-mobile/assistant-app.tsx:183-241` | ПРОЙДЕНО |

## Находки

| # | важность | путь:строка | проблема | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 1 | важно | `src/app/page.tsx:10`, `src/app/(auth)/login/page.tsx:9` | «Первого входа» в коде нет: и корневой редирект, и после вход ведут только по роли (`roleHomeRoute`). Признак новизны (флаг/дата первого входа) нигде не читается | Новый оператор/диспетчер приходит в УЖЕ наполненную систему — онбординг, который зависит от пустоты БД, не покажется ни разу; человек остаётся без ориентации | Завести признак «первый вход» (поле даты в БД уже есть — `lastLoginAt`, `src/services/users/user-service.ts:138`) и показывать разовую подсказку, не только на пустых данных |
| 2 | важно | `src/components/piling/admin-dashboard.tsx:324` (`emptySystem`), `:454` | Блок «С чего начать» включается только при отсутствии И объектов, И техники (`analytics.length === 0 && rigsTotal === 0`) | Свежая база: завели один объект — блок исчез, хотя пользователей и бригад ещё нет; администратор остаётся без подсказки на середине онбординга | Считать шаги онбординга как чек-лист (по факту наличия справочников/объектов/техники/пользователей/бригад), а не как «всё или ничего» |
| 3 | важно | `src/components/piling/admin-dashboard.tsx:58-64` | Список шагов онбординга статичен и не фильтруется правами: роли с общим домашним `/admin` (ДИСПЕТЧЕР, МАСТЕР) видят пункты, закрытые им | ДИСПЕТЧЕР: в его меню нет «Справочников» и «Пользователей» (`src/components/piling/icons/role-navigation.ts:80-93` — их добавляет только ADMIN, `:155-160`). Нажатие пункта 1 или 4 уводит на `/no-access` (`src/lib/require-page-ability.ts:22`) — тупик с первого экрана | Фильтровать пункты по `useAbility(...)`, как это уже сделано для ссылки «Добавить установку» (`admin-dashboard.tsx:520`) |
| 4 | важно | `src/components/piling/to/readiness/screens/safety-overview-screen.tsx:141`, `:226`, `:478` | Домашний экран ИНЖЕНЕРА ОТ (`/admin/safety` → вид «Обзор») не даёт первого действия: на пустой базе все KPI — прочерк «—», журнал — «Записей пока нет» | Роль закрывает допуски лично; на новой базе ей не сказано ни «заведите сотрудника», ни «проведите инструктаж». Сравните с МЕХАНИКОМ, у которого есть лента «Что делать сейчас» (`readiness-centre.tsx:217`) | Добавить на «Обзор» блок первого шага по аналогии с `ReadinessCentre` (следующее действие + пилюля состояния) |
| 5 | мелочь | `src/components/piling/operator-mobile/ui.tsx:68-73` | На первом экране оператора одновременно две кнопки про одно и то же действие: футер экрана `BigButton` (`identity-screen.tsx:43` — «Проверить средства защиты») и панель «Следующий шаг» (`step-bar.tsx:113`, подпись = тот же шаг из `shift-next-step.ts:77`) | Первый экран машиниста показывает две конкурирующие «следующие» кнопки подряд; какую нажимать — неочевидно | Оставить одну: либо убрать футер на фазе IDENTITY, либо не дублировать шаг в панели |
| 6 | мелочь | `src/components/piling/admin-dashboard.tsx:58-64` | Шаги онбординга не отмечают, что уже сделано, и не закрываются вручную | Администратор не видит прогресса «2 из 5»; после появления объекта+техники блок пропадает целиком (см. №2) | Помечать выполненные шаги галочкой, как в `readiness-centre.tsx:229` (пилюля «Выполнено») |
| 7 | мелочь | `src/components/piling/icons/role-navigation.ts:124-142` | МАСТЕР попадает на `/admin`, но его меню и права урезаны; онбординг-текст для него не отличается от админского | Мастер читает «Заполните разделы по порядку» (`admin-dashboard.tsx:458`), хотя половину этих разделов ему не открыть | Текст и шаги онбординга делать по фактическим правам роли |
| 8 | мелочь | `src/components/piling/to/readiness/screens/readiness-centre.tsx:619-624` | Пустое состояние «Установки не найдены» ведёт на `/admin/equipment` (кнопка «Открыть установки») | Путь тот же, что и в №3/№4: для роли без `equipment.read` это `/no-access`. В остальном экран ведёт себя корректно (объясняет причину, а не винит фильтр) | Проверять право перед показом кнопки |

## Не проверено

- Точный набор прав ролей DISPATCHER / FOREMAN (`dictionary.manage`, `users.manage`, `sites.read_all`, `equipment.read`). Вывод №3 и №7 сделан по составу меню (`src/components/piling/icons/role-navigation.ts`) и по прямому комментарию в `src/components/piling/admin-dashboard.tsx:92`; сам `src/services/auth/authorization-service.ts` не читал — файл в списке недоступных (AGENTS.md §1), статус соответствующих находок — ГИПОТЕЗА.
- Реальное поведение в браузере не проверялось (нет запуска приложения, Playwright не вызывался): все выводы — из чтения кода.
- Не проверено, появляется ли блок «С чего начать» при пустой базе для роли МАСТЕР на практике — у роли «Мастер» нет живых пользователей по решению владельца (AGENTS.md §1), сценарий теоретический.
- Не проверял экран `/login` на предмет подсказок о ролях за пределами чтения `src/components/piling/login-page.tsx` (176 строк): строк с демо-доступами/подсказками не найдено, но верстку не рендерил.
- Фрозенные области (`src/app/operator/**`, `src/app/orion/**`, варианты экрана оператора) не разбирались по правилам задачи; экран `/operator` v10 читал только в объёме, нужном для таблицы.
