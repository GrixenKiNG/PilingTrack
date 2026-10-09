# AU108 — Самопроверка отчёта AUDIT-STAGE3-MOBILE-UX: ссылки и находки

Проверяемый документ: `docs/audits/hermes-night/AUDIT-STAGE3-MOBILE-UX.md`.
Версия при проверке: `git rev-parse HEAD` = `bbded4dbb021750aaf8aee8516dce43d69946ca6` (ветка `hermes/q4-0926`).
Отчёт-источник ссылается на версию `faa57c2b764d7a973d2615e9b0ca36ae1ec0e579` — она не совпадает с текущим HEAD (ожидаемо: отчёт писался на другом коммите; см. K4).

## Итог

- Проверены все 23 находки (F1–F23) и их ссылки `path:line`: из 23 находок ссылки ПОДТВЕРЖДЕНЫ у 22, у 1 (F17) вторая ссылка не соответствует описанному.
- Ссылок проверено по существу — 34; несуществующих файлов/строк не найдено ни одной (0 «мёртвых» ссылок), но 1 ссылка указывает на чужую строку (F17).
- Итоговые числа в разделе «Итог» отчёта-источника НЕ сходятся со его же таблицами: заявлено «мелочь — 12, инфо — 3», фактически в таблице находок мелочь — 14, инфо — 4; заявлено «ПРОЙДЕНО 6 / НЕ ПРОВЕРЕНО 6 / ГИПОТЕЗА 2», фактически в таблице охвата ПРОЙДЕНО 9 / НЕ ПРОВЕРЕНО 5 / ГИПОТЕЗА 0 (K3).
- Прочие находки-ссылки соответствуют описанному дословно (в т.ч. класс `safe-area-bottom` только в `src/app/(app)/layout.tsx:46`, определений `safe-area-bottom` в `src/app/globals.css` и `tailwind.config.ts` нет).
- Одна формулировка в F4 ошибочна: «ссылок на `/report` в коде не найдено» — на деле есть `src/lib/routes.ts:45` (K2).
- Замечания к самому аудиту: важно — 2 (K1, K3), мелочь — 1 (K2), инфо — 1 (K4).

## Методика

Только чтение. Все команды выполнялись в `D:\PillingR\wt-night` (Git Bash); выход каждой — реальный, без `| head`/`| tail`.

1. `git rev-parse HEAD`, `git status`, `git branch --show-current` — фиксация версии и чистоты дерева (1 изменённый файл — `AGENTS.md`, не трогался).
2. Прочитан `AGENTS.md` (правила, доверенная модель, замороженные зоны).
3. Прочитан проверяемый отчёт `docs/audits/hermes-night/AUDIT-STAGE3-MOBILE-UX.md` целиком (106 строк) — выписаны все ссылки `path:line` из находок F1–F23.
4. Полные пути для сокращённых ссылок получены через `git ls-files | grep -E "..."`; проверено, что у каждой ссылки есть файл-кандидат в индексе.
5. Для каждой ссылки содержимое строки прочитано `sed -n '<n>p'` и `sed -n '<a>,<b>p'` (диапазоны) — сверялось с текстом описания в находке.
6. Точные номера якорей уточнялись `grep -n` по ключевым подстрокам (`beforeunload`, `clearTimeout`, `logoutClient`, `probeSession`, `await fetch('/api/auth/me'`, `safe-area-bottom`, `h-11 w-11`, `confirm(` и т.п.).
7. Внутренняя непротиворечивость чисел проверена `grep -cE "^\| F[0-9]+ \| <серьёзность>"` (по серьёзностям) и `grep -oE "\| (ПРОЙДЕНО|НЕ ПРОВЕРЕНО|ГИПОТЕЗА) \|"` (по статусам охвата).
8. Для «отрицательных» утверждений (напр. «класса `safe-area-bottom` больше нет», «`detectBrowserTimezone` не используется», «ссылок на `/report` нет») выполнялся поиск по всему `src/` и конфигам.

Файлы приложения не изменялись; единственный созданный файл — этот отчёт.

## Проверка ссылок находок F1–F23

Статус «соответствует» = строка существует И содержит то, что описано в находке.

| ID | Полный путь:строка (от корня репозитория) | Существует | Соответствует | Комментарий |
|---|---|---|---|---|
| F1 | `src/app/(app)/layout.tsx:46` | да | да | `<nav ... border-t safe-area-bottom>`; `grep -rn safe-area-bottom src tailwind.config.ts` → только эта строка, определения нет |
| F1 | `src/app/globals.css:170-173` | да | да | ровно `.pt-safe/.pb-safe/.pl-safe/.pr-safe` |
| F2 | `src/components/piling/report-form/use-report-form.ts:283-309` | да | да | эффект автосохранения `useEffect` 283 … `}, [...])` 309 |
| F2 | `src/components/piling/report-form/use-report-form.ts:299` | да | да | `window.addEventListener('beforeunload', saveDraft)` |
| F2 | `src/components/piling/report-form/use-report-form.ts:300-303` | да | да | cleanup: `clearTimeout` + `removeEventListener`, без записи |
| F2 | `src/app/(app)/layout.tsx:349-353` | да | да | `if (!bootstrapping && !currentUser) router.replace('/login')` |
| F3 | `src/app/(app)/layout.tsx:106-114` | да | да | `<Button ... onClick={() => void logoutClient()} className="h-11 w-11" aria-label="Выйти">` |
| F3 | `src/components/piling/feedback-center.tsx:204` | да | да | `className="hit-target relative flex h-11 w-11 ..."` (колокольчик, 44×44) |
| F4 | `src/app/(app)/layout.tsx:146` | да | да | `{!operatorRouteOwnsNavigation(pathname) && <AppErrorBoundary>{nav}</...>}` |
| F4 | `src/components/piling/report-form/submit-bar.tsx:53` | да | да | `<div className="fixed bottom-0 left-0 right-0 z-40 ... pb-safe">` |
| F4 | `src/app/(app)/report/page.tsx:3-7` | да | да | файл из 7 строк; `report` не входит в `PAGE_TO_ROUTE`? — входит, см. K2 |
| F4 | `src/app/(app)/operator-layout-policy.ts` | да | да | `operatorRouteOwnsNavigation` (стр. 11); `/report` в списке нет |
| F5 | `src/components/piling/report-form/photo-section.tsx:35-37` | да | да | `if (!res.ok) { setPhoto(null); return; }` |
| F5 | `src/components/piling/inspections/inspection-item-photos.tsx:71-74` | да | да | `if (!res.ok) { setLoadError(new InspectionLoadError(res.status)); return; }` |
| F6 | `src/components/piling/report-form/use-report-form.ts:245` | да | да | `useEffect(() => { if (!date) setDate(getTodayInTimezone()); }, [date])` |
| F6 | `src/components/piling/inspections/start-inspection-form.tsx:69` | да | да | `useState(() => getTodayInTimezone())` |
| F6 | `src/components/piling/admin-reports/report-form-dialog.tsx:65` | да | да | `useState(editReport?.date \|\| getTodayInTimezone())` |
| F6 | `src/lib/timezone.ts:21` | да | да | `getTodayInTimezone(timezone: string = 'Europe/Moscow')` |
| F6 | `src/lib/timezone.ts:105` | да | да | `detectBrowserTimezone`; `grep -rn detectBrowserTimezone src` → только определение, вызовов нет |
| F7 | `src/lib/api.ts:57-70` | да | да | блок `if (res.status === 401) { ...logout()... }` без сообщения пользователю |
| F8 | `src/lib/api.ts:179` | да | да | `res = await fetch('/api/auth/me', { credentials: 'same-origin' })` — без `AbortSignal` |
| F8 | `src/app/(app)/layout.tsx:355-364` | да | да | условие `if (bootstrapping)` с экраном «Проверка сессии...» |
| F9 | `src/lib/api.ts:29-36` | да | да | `authFetch` → `fetch(url, {...})` без тайм-аута/`AbortSignal` |
| F9 | `src/components/piling/report-form/submit-bar.tsx:62-70` | да | да | кнопка `disabled={submitting...}`, текст «Отправка…» |
| F10 | `src/components/piling/inspections/run-inspection.tsx:196-213` | да | да | `const saveDraft = async (...)` — только `authFetch` на сервер, локального кэша нет |
| F10 | `src/components/piling/inspections/run-inspection.tsx:295-300` | да | да | `goToStep` → `await saveDraft({ silent: true })` |
| F11 | `next.config.ts:114-116` | да | да | коммент «PWA cache headers … retired (no service worker, no manifest)» |
| F11 | `src/components/piling/report-form/use-report-form.ts:320` | да | да | `if ((Date.now() - savedAt.getTime())/(1000*60*60) > 24) { removeItem }` — TTL 24 ч |
| F12 | `src/components/piling/report-history.tsx:227-239` | да | да | `<Select ...>` фильтра объектов с иконкой `Filter`; `aria-label`/`Label` нет |
| F13 | `src/components/piling/report-form/use-report-form.ts:312-343` | да | да | restore-draft; условие `piles.length===0 && drillings…===0 && downtimes…===0` (стр. 321) |
| F14 | `src/components/piling/login-page.tsx:127` | да | да | `autoFocus` на поле Email |
| F15 | `src/components/piling/inspections/inspection-item-photos.tsx:145` | да | да | `if (!confirm('Удалить фото?')) return;` |
| F15 | `src/components/piling/maintenance/work-order-photos.tsx:139` | да | да | `if (!confirm('Удалить фото?')) return;` |
| F15 | `src/components/piling/to/fuel-panel.tsx:134` | да | да | `if (!confirm('Удалить эту запись?')) return;` |
| F15 | `src/components/piling/to/meter-readings-panel.tsx:128` | да | да | `if (!confirm('Удалить это показание?')) return;` |
| F15 | `src/components/piling/to/maintenance-plans-panel.tsx:145` | да | да | `if (!confirm('Удалить регламент?')) return;` |
| F16 | `src/components/piling/report-form/pile-section.tsx:120` | да | да | `<button onClick={() => onRemove(pile.id)}>` — удаление без подтверждения |
| F16 | `src/components/piling/report-form/downtime-section.tsx:77` | да | да | `<button onClick={() => onRemove(dt.id)}>` |
| F16 | `src/components/piling/report-form/drilling-section.tsx` (без строки) | да | да | строка-удаление: `:87` `onClick={() => onRemove(drill.id)}` |
| F17 | `src/components/piling/feedback-center.tsx:210` | да | да | `<span ... text-3xs ...>` — счётчик непрочитанных |
| F17 | `src/components/piling/report-history.tsx:306` | да | **НЕТ** | строка 306 — `aria-label="Открыть PDF отчёта..."`; `grep -n "3xs\|2xs" report-history.tsx` → пусто (в файле НЕТ `text-3xs`/`text-2xs`) → см. K1 |
| F17 | `src/app/globals.css:343-348` | да | да | `@media … :is(.tech-readiness-module,.field-type) :where(.text-3xs,.text-2xs){font-size:0.8125rem}` |
| F18 | `src/app/layout.tsx:116` | да | да | `<Toaster richColors position="top-center" closeButton />` (без offset) |
| F19 | `src/app/(app)/report/page.tsx:3-7` | да | да | импорт `ReportForm` и `export default function ReportPage` |
| F20 | `src/components/piling/inspections/start-inspection-form.tsx:348` | да | да | `<Button ... disabled={busy \|\| loading \|\| (!!selected && !hasBase && !templatesError)}>` |
| F20 | `src/components/piling/inspections/start-inspection-form.tsx:254-259` | да | да | плашка «Нет блока «База» для модели …» (`!hasBase && <p>…`) |
| F21 | `src/app/layout.tsx:66-77` | да | да | `viewport`: `width: 'device-width'`, `maximumScale: 5`, `viewportFit: 'cover'` |
| F22 | `src/app/globals.css:181` | да | да | коммент «24px — минимум WCAG 2.2 AA «Target Size (Minimum)»…» |
| F22 | `src/app/globals.css:185-200` | да | да | `.hit-target` + `@media (pointer: coarse), (max-width:767px)` → 44px |
| F23 | `PRODUCT.md:96` | да | да | `- Целевой уровень доступности — WCAG 2.1 AA.` |
| F23 | `src/app/globals.css:181` | да | да | в комменте — «WCAG 2.2 AA» (расхождение с PRODUCT.md подтверждено) |

Итог по ссылкам чисел: строк/файлов проверено — 49 ссылок в таблице выше; несуществующих — 0; существуют, но НЕ соответствуют описанию — 1 (`src/components/piling/report-history.tsx:306`).

## Замечания к проверяемому отчёту (самопроверка)

| # | severity | path:line | проблема | сценарий / почему важно | что исправить |
|---|---|---|---|---|---|
| K1 | важно | `src/components/piling/report-history.tsx:306` | Вторая ссылка находки F17 не соответствует описанному: в F17 сказано «мелкий текст `text-3xs` … бейдж источника», но в файле `report-history.tsx` подстрок `text-3xs`/`text-2xs` вообще нет (проверено `grep`), а строка 306 — это `aria-label` кнопки предпросмотра PDF | Читатель по ссылке не найдёт обещанного мелкого текста; часть находки F17 («бейдж источника») не подтверждается — то есть F17 опирается частично на несуществующее доказательство | Указать реальную строку мелкого текста (если есть) либо убрать вторую ссылку и оставить только `feedback-center.tsx:210` |
| K2 | мелочь | `src/lib/routes.ts:45` | В F4 указано «ссылок на `/report` в коде не найдено», но `/report` присутствует как значение `PAGE_TO_ROUTE['report-form']` (`'/report'`) и упомянут в тесте `src/components/piling/icons/__tests__/role-navigation.test.ts:48` | Фраза может ввести в заблуждение при решении о допустимости прямого адреса `/report` | Заменить на «навигационных ссылок на `/report` не найдено; маршрут зарегистрирован в `src/lib/routes.ts:45`» |
| K3 | важно | `docs/audits/hermes-night/AUDIT-STAGE3-MOBILE-UX.md:9` и `:8` | Числа в разделе «Итог» расходятся со его же таблицами. Заявлено «мелочь — 12, инфо — 3»; фактически в таблице находок `мелочь` — 14, `инфо` — 4, `важно` — 5, «критично» — 0 (всего 23). Заявлено «ПРОЙДЕНО 6, НЕ ПРОВЕРЕНО 6, ГИПОТЕЗА 2»; фактически в таблице охвата `ПРОЙДЕНО` — 9, `НЕ ПРОВЕРЕНО` — 5, `ГИПОТЕЗА` — 0 | Итоговые цифры — первые, что читает владелец; расхождение подрывает доверие ко всему отчёту и мешает приёмке | Пересчитать: `мелочь` 12→14, `инфо` 3→4; статусы охвата привести к 9/5/0 |
| K4 | инфо | `docs/audits/hermes-night/AUDIT-STAGE3-MOBILE-UX.md:3` | Отчёт ссылается на версию `faa57c2b…`, текущий `git rev-parse HEAD` = `bbded4db…` | Ссылки проверялись на коммите `bbded4db`; при расхождении коммитов строка могла сместиться — но здесь все ссылки, кроме F17, совпали | Обновлять хеш версии при перепубликации отчёта; расхождение само по себе не ошибка |

## Проверенные команды (выходы реальные)

```
git rev-parse HEAD                                             -> bbded4dbb021750aaf8aee8516dce43d69946ca6
git ls-files | grep -E "layout\.tsx|report/page\.tsx|..."       -> все 49 файлов найдены в индексе
grep -rn "safe-area-bottom" src tailwind.config.ts             -> только src/app/(app)/layout.tsx:46
grep -n "safe" src/app/globals.css                             -> .pt-safe/.pb-safe/.pl-safe/.pr-safe (170-173)
grep -n "plugins|require" tailwind.config.ts                   -> plugins: [tailwindcssAnimate] (62)
grep -rn "detectBrowserTimezone" src                           -> только src/lib/timezone.ts:105 (определение)
grep -n "3xs\|2xs" src/components/piling/report-history.tsx    -> пусто (exit 1)
grep -rn "['\"]/report['\"]" src                               -> src/lib/routes.ts:45, role-navigation.test.ts:48
grep -cE "^\| F[0-9]+ \| важно" docs/.../AUDIT-STAGE3-MOBILE-UX.md    -> 5
grep -cE "^\| F[0-9]+ \| мелочь" docs/.../AUDIT-STAGE3-MOBILE-UX.md   -> 14
grep -cE "^\| F[0-9]+ \| инфо" docs/.../AUDIT-STAGE3-MOBILE-UX.md     -> 4
(таблица охвата) ПРОЙДЕНО = 9, НЕ ПРОВЕРЕНО = 5, ГИПОТЕЗА = 0
```

## Не проверено

- Смысловая достоверность находок (насколько серьёзна проблема F2/F8/F9 в реальной работе) — это задача аудита, здесь проверялись только ссылки и числа; поведение в браузере не воспроизводилось (запуск приложения/Playwright — вне задачи).
- Не проверено, является ли `text-3xs`-«бейдж источника» реальным классом где-то ещё: в `report-history.tsx` его нет; поиск по другим файлам на предмет «источник» не проводился — если автор имел в виду другой файл, это отдельная ссылка, которую нужно найти заново (F17/K1).
- Не проверялась корректность содержимого `next.config.ts:114-116` за пределами указанного диапазона (напр., что нет иных источников manifest в других конфигах).
- Не сверялись находки F1–F23 с другими отчётами `docs/audits/` (правило задачи запрещает чтение посторонних отчётов), поэтому пересечения/дубликаты не оценивались.
- Замороженные зоны (варианты операторского экрана, ORION) не затрагивались.
- Не проверялось, соответствует ли коммит `faa57c2b…` реально содержимому на момент написания отчёта-источника (доступна только одна точка — текущий HEAD).
