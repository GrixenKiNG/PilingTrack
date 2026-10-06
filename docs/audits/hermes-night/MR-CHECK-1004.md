# MR-CHECK-1004 — Приёмка десяти новых результатов Hermes

READ-ONLY приёмка пакета из 10 коммитов на ветке `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).
Код не менялся, тесты не создавались; единственная запись — этот отчёт.
Стартовое состояние: HEAD `8080f36984534a763ce1c8a78567b9eaf84aeebd`, `git status --porcelain` — чисто.
`.env*` не читались и не менялись, к production/SSH не подключались, ничего не сливалось и не пушилось.

## Итог

- Находок **12**: **критично — 0**, **важно — 4**, **мелочь — 8**. Пакет не ломает сборку и тесты
  (tsc/lint/test:unit/playwright --list/build — все exit 0), пути изменённых файлов вне замороженных
  зон, вне auth/security/tenancy, схему Prisma не трогали.
- Верхние пять:
  1. **важно** — проверка в браузере (desktop и 375px) **не выполнена**: единственный живой сервер на
     `localhost:3000` запущен из **другой** рабочей копии (`D:\PillingR\my-project`), а не из
     `wt-night`. Три сценария задания в реальном браузере не подтверждены (см. №1).
  2. **важно** — правка F-R141 №1 (учёт даты ТО в «Обслуживании») не покрыта ни одним тестом:
     теста на `MaintenanceScreen` нет вовсе, `checkMaintenanceDue` напрямую не тестируется (№2).
  3. **важно** — F-R141 №2 («блокеры по действию») закрыто **частично**: та же плитка и блок
     «Критические блокеры» на центре готовности по-прежнему красят и называют ЛЮБОЙ блокер
     критическим (`readiness-centre.tsx:292-298,731`) (№3).
  4. **важно/к сведению** — индекс GitNexus отстаёт на 247 коммитов; `detect_changes` относительно
     `03d73ee4` полон (17 файлов = `git diff --stat`), но `impact` ходит по устаревшему индексу —
     известный HIGH `buildAuthoritativeReadinessPresentation` подтверждён, но его множество вызовов
     может быть неполным (№4).
  5. **мелочь, но важно для приёмки** — 3 теста T-PDF-FORMAT помечены `it.fails` на **реальные,
     незакрытые** дефекты `src/lib/pdf-generator/format.ts` (печатает «NaN»/«Infinity»; пробел не «—»;
     битая дата как есть). Это не skipped — это ожидаемый fail; дефекты остаются открытыми (№6).
- Итог по коммитам: все 10 — **кандидат**; у `F-R140-TOP` и `F-R141-TOP` дополнительно
  **UI-проверка заблокирована**. Ничего не отклонено, ничего не слито.

## Методика

Что делал и как повторить (path:line — по фактически открытым файлам; Python не используется, только
`git`/`node`/`read_file`/`search_files`/`netstat`/`curl`):

1. `git rev-parse HEAD`, `git status --porcelain`, `git branch --show-current` — зафиксированы HEAD и
   чистота дерева. `AGENTS.md` прочитан целиком (модель доверия, заморозка, «выглядит мёртвым»).
2. `git show <sha>` по каждому из 10 коммитов + `git show --stat`; `git diff --stat 03d73ee4..HEAD`
   (10 коммитов, 17 файлов, +1665/−34) — проверка полноты и «разрешённых путей».
3. GitNexus: `node .gitnexus/run.cjs detect-changes --scope compare --base-ref 03d73ee4 --repo .`
   (17 файлов, 17 символов, affected processes 0, risk low, не partial/truncated);
   `node .gitnexus/run.cjs impact buildAuthoritativeReadinessPresentation --direction upstream --repo .`
   (risk HIGH, impacted 6, direct 3, epistemic exact, `staleness.commitsBehind: 247`).
4. Проверка сквозной передачи данных для правок: `src/lib/maintenance-due.ts:30-61` (helper),
   `src/modules/readiness/domain/readiness-score.ts:206-224` (блокеры с `action`/`actionLabel`),
   `readiness-score.ts` (application) `:218` (`serializedBlockers`), `api/contracts.ts:246-252`
   (схема требует `action`), `equipment-query.service.ts:377-378,442-443,496` (в выборку входит
   `nextMaintenanceDate`) — то есть правки не no-op, поле реально доходит до экранов.
5. Проверка тона/цветов: `readiness-rules.ts:36-68,97-101` (`BlockerAction`), `shared.tsx:33-51`
   (`blockerTone`/`BLOCKER_TONE_CLASS`/`BLOCKER_TONE_LABEL`), `globals.css:46-51,112-117`
   (токены `warning`/`info`/`*-strong` существуют).
6. Поиск покрытия: `search_files` по `MaintenanceScreen`, `checkMaintenanceDue`, `PresentationNotice`,
   `критическ` в `src/components/piling/to`; чтение существующих спеков
   `screens/__tests__/readiness-centre.test.tsx`, `fleet-screen.test.tsx`.
7. Проверки §6 AGENTS.md — каждый отдельной командой, без `tail`/`head`-пайпов:
   - `.next/dev/types`: сначала проверил абсолютный путь (`realpath` → `D:/PillingR/wt-night/.next/dev/types`);
     каталога **нет** → `rm -rf` фактически не требовался, ничего не удалялось.
   - `npx tsc --noEmit` — **exit 0**.
   - `npm run lint` — **exit 0** (0 errors, 7 warnings; все — в НЕизменённых файлах:
     `tests/integration/tech-readiness-*.spec.ts`, `src/app/api/crews/all/route.ts:26`).
   - `npm run test:unit` — **exit 0**: Test Files 341 passed | 2 skipped (343);
     Tests **3201 passed | 3 expected fail | 39 skipped** (3243). 3 expected fail — это 3 `it.fails`
     в `src/lib/__tests__/pdf-generator.test.ts` (T-PDF-FORMAT), НЕ skipped.
   - `npx playwright test --list` — **exit 0**: `Total: 99 tests in 11 files`.
   - `npm run build` — **exit 0** (compiled with warnings: bullmq не резолвит `@valkey/valkey-glide` —
     предсуществующее предупреждение из `node_modules` соседней копии, не связано с пакетом).
8. Локальная среда: `netstat -ano | grep LISTENING` — на `:3000` слушает PID 13980, чей командной
   строкой является `D:\PillingR\my-project\node_modules\next\dist\server\lib\start-server.js`;
   `curl /login` и `/api/health` → 200. То есть живой сервер обслуживает ДРУГУЮ рабочую копию.
   `netstat`/`curl`/`powershell Get-CimInstance` — без чтения секретов.
9. Сверка с предыдущими аудитами: прочитаны целиком `docs/audits/hermes-night/R140-admin-reports-list.md`
   и `R141-readiness-board.md` (какие пункты закрыты, какие повторяются); правки F-R140/F-R141 сверены
   с их «Итог/Топ-5». Закрытые ранее пункты не переоткрывал; продуктовые пробелы (нет статуса «архив»)
   отмечены как решение владельца, а не баг (см. №12).

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить |
|---|----------|-----------|----------|--------------------------|-----------------|
| 1 | важно | `netstat :3000` → PID 13980 → `D:\PillingR\my-project\node_modules\next\dist\server\lib\start-server.js` (не `wt-night`) | Проверка в браузере desktop и 375px не выполнена: единственный живой локальный сервер обслуживает другую рабочую копию, не ветку `hermes/q4-0926` | Три обязательных сценария задания (отбор/сортировка списка отчётов; ТО по дате и моточасам; три действия блокера) в РЕАЛЬНОМ браузере НЕ подтверждены — есть только компонентные render-тесты (см. №2, №3) и tsc/build | Поднять `next dev`/`next start` из `wt-night` на отдельном порту против локальной (НЕ production) БД и пройти сценарии на 1440 и 375px; до этого UI-приёмку считать заблокированной |
| 2 | важно | `src/components/piling/to/readiness/screens/maintenance-screen.tsx:161-189` | Правка F-R141 №1 (учёт `nextMaintenanceDate` в «Сервисном плане») не покрыта тестом: совпадений `MaintenanceScreen` в `*.test.tsx` — ноль, `checkMaintenanceDue` напрямую не тестируется | Регрессия в сортировке (`rank`) или в подписи «просрочено по дате N дн. · перепробег M м/ч» не будет поймана тестами — корректность доказана только чтением кода и `tsc`/`build` | Дописать кейс в существующий спек вкладки «Обслуживание» (или `fleet-*`): установка с просроченной `nextMaintenanceDate` без моточасов → подпись и порядок «просрочено» первым |
| 3 | важно | `src/components/piling/to/readiness/screens/readiness-centre.tsx:292-298` и `:731` | F-R141 №2 закрыто частично: плитка «Замечания и дефекты» (pill красный при любом блокере, строка `caption: 'Критические'` = `blockers.length`) и блок «Критические блокеры» (`:731`) по-прежнему называют/красят ЛЮБОЙ блокер критическим | Тот же дефект, что чинил F-R141 №2, но в двух других местах того же экрана: «нет осмотра за сегодня» (`RETURN_TO_OPERATOR`) снова читается как критическое замечание | Покрасить/подписать эти места по `blockerTone` (как панель), либо переименовать в «Блокеры»/«Требует внимания» |
| 4 | важно | `src/components/piling/to/readiness/authoritative-presentation.ts` (impact) | Индекс GitNexus отстаёт: `impact buildAuthoritativeReadinessPresentation` → `risk: HIGH`, impacted 6, direct 3 (`buildFleetItems`, `ReadinessCentre`, `ToModule.readinessByEquipment`), но `staleness.commitsBehind: 247` | Множество влияния HIGH-риска получено по устаревшему графу: новые вызывающие после 247 коммитов могли не попасть. `detect_changes` относительно `03d73ee4` при этом полон (17 файлов = `git diff --stat`), risk low | Переиндексировать (`node .gitnexus/run.cjs analyze --index-only`) и повторить `impact`; до этого набор считать подтверждённым только на глубине 1 |
| 5 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:52-77,464-469` | Кнопки-заголовки сортировки не сообщают состояние: нет `aria-sort` на колонке и `aria-pressed` на кнопке | Диспетчер с экранным диктором не слышит текущий ключ/направление сортировки (визуальная стрелка ↑/↓ не читается) | Добавить `aria-sort` (ascending/descending/none) на активный заголовок |
| 6 | мелочь (для приёмки важно) | `src/lib/__tests__/pdf-generator.test.ts` (3× `it.fails`) | T-PDF-FORMAT фиксирует 3 РЕАЛЬНЫХ дефекта `src/lib/pdf-generator/format.ts` (`safeText` печатает «NaN»/«Infinity»; строка из пробелов не даёт «—»; `formatRuDate` отдаёт битую дату «как есть») | Это ожидаемые падения, а не skipped, но дефекты **остаются открытыми**: в PDF всё ещё может попасть «NaN»/машинная дата. Пакет их не чинит, только закрепляет | Завести отдельную задачу на `safeText`/`formatRuDate`; 3 пункта не считать закрытыми |
| 7 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:246-247,287` | Отбор «Черновики/Сданные» считается по УЖЕ загруженным ≤100 строкам (как прочие быстрые фильтры) | При числе отчётов >100 отбор по статусу молча неполон — то же ограничение R140 №5; серверного параметра `status` нет (`/api/reports/*` вне разрешённых путей). Честно описано в сообщении коммита | Перенести фильтр статуса на сервер либо подписать неполноту («фильтр по загруженным») |
| 8 | мелочь | `src/components/piling/to/readiness/authoritative-presentation.ts:21,156` | Новое обязательное поле `action` в `PresentationNotice`; для не-строки/отсутствия выставляется `null` → тон `critical` | Безопасная перестраховка: старый снимок без `action` покажет блокер красным, но не спутает с возвратом оператору | Оставить как есть (консервативный дефолт); при желании мигрировать старые снимки |
| 9 | мелочь | коммиты `4b79e94f`,`b64cec4e`,`5a9e77c0`,`02f41f4c`,`c7571679` (+`7a5af25b`) | Аудит-правило AGENTS §5 «no new test files unless the task requires one»: пакет добавляет НОВЫЕ файлы тестов | Модули `settings`/`monitoring`/`safety`/`crews`/`sites` до этого не имели тестов; задачи обозначены как T-* (тестовые), поэтому расширение оправдано, но его стоит подтвердить | Подтвердить у владельца, что новые тест-файлы для T-* согласованы |
| 10 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx` vs `src/modules/reports/application/queries/report-query.service.ts:161` | F-R140-TOP добавляет сортировку только на КЛИЕНТЕ; серверный `orderBy: { date: 'desc' }` не менялся — R140 №4 (курсор без тай-брейкера `id`) и №5 (неполнота фильтров) НЕ закрыты | Сортировка при >100 отчётах тоже неполна; возможны повтор/пропуск строки между страницами «Загрузить ещё». Коммит честно называет это частичным закрытием №2/№3 | Признать №3 частично закрытым; №4 закрывать отдельно серверным тай-брейкером (вне текущих разрешённых путей) |
| 11 | мелочь | `AGENTS.md:55` против `npm run lint` | Заявленный «lint baseline is zero warnings» не соответствует факту: eslint даёт 7 предупреждений (`tests/integration/tech-readiness-enforcement.spec.ts:52`, `...-projection.spec.ts:36`, `...-shifts.spec.ts:60,249`, `...-work-permits.spec.ts:49,105`, `src/app/api/crews/all/route.ts:26`), exit 0 | Не дефект пакета (ни один файл не изменён), но расхождение описания baseline с реальностью | Либо почистить предупреждения, либо поправить строку в AGENTS.md |
| 12 | мелочь | `docs/audits/hermes-night/R140-admin-reports-list.md:23-25` (`№1`) | Пункт «нет статуса архив» намеренно не менялся (нет поля в `prisma/schema.prisma` и решения владельца) | Это продуктовый пробел, а не баг кода; корректно оставлен вне правки и вне разрешённых путей | Не переоткрывать как дефект; закрыть решением владельца |

### Не переоткрываю (уже закрыто / продуктовое решение)

- `R140 №2/№3` (нет фильтра по статусу, нет сортировки) — закрыто коммитом `67664a62` на клиентском
  уровне, тесты `admin-reports.test.tsx` (новые describe) зелёные.
- `R140 №1` (архив) — продуктовое решение владельца, не баг (см. №12).
- `R141 №1/№2` — закрыто коммитом `8080f369` (№1 полностью по коду, №2 частично — см. №3).
- Роли «Мастер»/«Инженер ОТ», телеметрия, multi-tenancy, замороженные `operator*`/ORION, строка
  `@custom-variant dark` в `globals.css`, инлайновые `eslint-disable` — не трогались (проверено по
  `git diff --stat`: их в изменениях нет).

## Не проверено

- **Браузер (desktop и 375px) — BLOCKED.** Живой `:3000` обслуживает другую рабочую копию
  (`D:\PillingR\my-project`), а поднимать app из `wt-night` я не стал: это потребовало бы валидации
  `.env` и подключения к БД, про которую нельзя утверждать, что она локальная, а не production
  (правило «no secrets / no production»). Три сценария задания **не заявляю пройденными**.
  Косвенное покрытие: render-тесты `admin-reports.test.tsx` (отбор/сортировка) и
  `readiness-centre.test.tsx`/`fleet-screen.test.tsx` (тон блокеров) зелёные в `test:unit`.
- **`maintenance-screen` (ТО по дате и моточасам) визуально и тестом не проверен** — только чтение
  кода, `tsc`, `build` (см. №2).
- **Фактические данные/снимки готовности не смотрел**: БД не открывал, реальные `currentReadiness`
  не читал. Что поле `action` реально присутствует в снимках конкретного тенанта — выведено из кода
  (`readiness-score.ts:206-224`, `readiness-score.ts:218`, `contracts.ts:246-252`), не из данных.
- **Опубликованные правила тенанта** (`readinessRuleSet` в БД) не проверял — тон блокера зависит от
  `action` в снимке; если тенант переопределил действие правила, вывод изменится.
- **GitNexus-индекс устарел на 247 коммитов (№4)**: полнота `impact` не гарантирована;
  `detect_changes` относительно `03d73ee4` — полный (совпал с `git diff --stat`).
- **Playwright-прогон не запускался** (только `--list`, 99 тестов/11 файлов): e2e требуют сервера и
  учётных данных; реальные аккаунты владельца/оператора не использовались.
- **Причина 7 lint-предупреждений и предупреждения сборки bullmq** — предсуществующие, вне scope
  пакета; их влияние на продукт не оценивал.
