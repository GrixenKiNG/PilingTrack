# W153 — достижимость уязвимостей npm: braces, deepmerge-ts, mysql2

Аудируемая версия кода: worktree `D:/PillingR/wt-audit-0f53`, SHA `0f53cd01`
(`0f53cd01a264ffae97e3eaa7fea7582d90bf657d`). Задача выполнена только чтением:
`package.json` и `package-lock.json` не менялись, `npm install` / `npm audit fix` / сборка
/ деплой не запускались. Единственная запись — этот отчёт. Frozen-зоны (экраны оператора,
сайт ОРИОН) не затрагивались.

## Итог

- **критично — 0, важно — 2, мелочь — 6** (все 8 находок ниже).
- Ответ на вопрос владельца: **ни одна из трёх заявленных «высоких» уязвимостей
  (`braces`, `deepmerge-ts`, `mysql2`) не достижима в рантайме продакшена.**
  Все три приходят «поездом» через инструменты:
  - `braces` 3.0.3 → цепочка линтера (`eslint-config-next → @next/eslint-plugin-next →
    fast-glob → micromatch → braces`), в образы `app`/`workers` не попадает вообще;
  - `deepmerge-ts` 7.1.5 → через `prisma → @prisma/config`; исполняется ровно один раз —
    в контейнере `migrate` при загрузке `prisma.config.ts`, вход — файл репозитория, не
    пользовательские данные;
  - `mysql2` 3.15.3 → через `prisma`, **в коде проекта не импортируется** (провайдер БД —
    PostgreSQL), подключается лениво только для MySQL-провайдера.
- **Важное уточнение к формулировке задачи.** Заявлены «три high»; фактический
  `npm audit --json` в этом SHA показывает **12 high** (critical 0). Три из задачи — часть
  цепочки `prisma`/`eslint`; остальные (`next`, `sharp`, `source-map-js`, `@next/…`) уже
  разобраны в W90 и R62. Счёт `metadata.vulnerabilities` = `{high:12, moderate:0, low:0}`.
- **Главная находка (важно):** `braces` **патча не существует**. Advisory
  GHSA-vfj7-8cjw-p6xm закрывает диапазон `<=3.0.3`, а `npm view braces versions` показывает,
  что `3.0.3` — **последний опубликованный релиз**. То есть цепочку линтера нельзя
  «починить» обновлением: единственный предлагаемый `npm audit` фикс — это **даунгрейд**
  `eslint-config-next` до 14.2.35 (`isSemVerMajor: true`), что делать нельзя.
- **Одна строка:** серверу эти три уязвимости сейчас не грозят; держать `npm audit fix
  --force` запертым (он откатывает `prisma` 7.10.0 → 6.19.3). Плановое обновление — `next`
  16.3.6 → 16.4.0 и `sharp` 0.35.4 → 0.35.5 (см. W90), это отдельные advisories.

## Методика (воспроизводимо)

Всё выполнялось в `D:/PillingR/wt-audit-0f53` (в этой ворктри нет `node_modules` и нет
`.next`, поэтому `npm ls` бесполезен — он печатает «UNMET DEPENDENCY»).

1. Версии и флаги из лока:
   `node -e "const l=require('./package-lock.json').packages; console.log(l['node_modules/<pkg>'].version, l['node_modules/<pkg>'].dev)"`.
   Плюс реверс-индекс: обход всех `packages[*].dependencies/peerDependencies/optionalDependencies`
   и поиск «кто требует X».
2. Объявления прямых зависимостей — `package.json` (`dependencies`/`devDependencies`/`overrides`).
3. Текущие advisories и доступные фиксы — `npm audit --json > $TMPDIR/audit-0f53.json`
   (exit=1 = есть находки), разбор полей `metadata.vulnerabilities`,
   `vulnerabilities[*].severity/isDirect/via/fixAvailable`, а также `via[*].range/severity/title`.
4. Доступность патча в реестре (только чтение):
   `npm view <pkg> versions --json` → фильтр «последняя стабильная» (без `-`) и «последняя в
   текущей мажорной ветке».
5. Состав образов — по тексту стадий `Dockerfile` (`deps`→`builder`→`migrate`→`runner`),
   `Dockerfile.workers` (`deps`→`builder`→`runner`); какой Dockerfile/target у какого сервиса —
   `docker-compose.yml:23-27,60-64,155-159` и боевой сборщик `scripts/deploy-prod.sh:37-44,63-91`.
6. Использование в коде: `grep -rn "<pkg>" src/ scripts/ prisma/`; для glob-поверхности —
   `grep -rnE "\b(glob|globSync|minimatch|micromatch|merge|deepmerge)\(" src/ scripts/ prisma/`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | что сделать |
|---|---|---|---|---|---|
| 1 | важно | `Dockerfile.workers:53,71`; `package.json:146`; lock `node_modules/prisma` `dev=false`; lock `@prisma/client` peerDeps `prisma:*` (`peerDependenciesMeta.prisma.optional=true`) | `prisma` объявлен devDependency, но лежит **в прод-дереве** (lock не ставит `dev`): npm считает его прод-зависимостью, потому что `@prisma/client` (прод) объявляет его опциональным peer-ом. Значит `npm prune --omit=dev` в `Dockerfile.workers:53` его **не удаляет**, и весь CLI-подграф (`@prisma/config`, `deepmerge-ts`, `mysql2`) уезжает в образ воркеров (`Dockerfile.workers:71`) | Образ воркеров несёт ~0,8 МБ `mysql2` + `deepmerge-ts` + весь prisma CLI, хотя воркеры их не грузят (`grep -rn "prisma" src/workers/` → пусто). И `npm audit` в проде будет вечно показывать эти «high», не отличая реальный рантайм от migrate | Только владелец: после `npm run db:generate` точечно удалить CLI-подграф в `Dockerfile.workers` (рядом с `next/@next/sharp`, строки 53-54). `Dockerfile*` вне моих прав |
| 2 | важно | lock `node_modules/braces` v3.0.3 (`dev=true`); advisory GHSA-vfj7-8cjw-p6xm, range `<=3.0.3`; `npm view braces versions` → latest stable **3.0.3** | **Патча у `braces` нет.** Уязвимый диапазон совпадает с последним релизом. Цепочка `eslint-config-next 16.3.6 → @next/eslint-plugin-next → fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3` | Обновить `braces`/`micromatch`/`fast-glob` до «фикса» невозможно — его не существует. `npm audit` предлагает **даунгрейд** `eslint-config-next` до 14.2.35 (`isSemVerMajor: true`) | Ничего не делать. Линтерный инструментарий, в рантайм не попадает. Не запускать `npm audit fix --force` |
| 3 | мелочь | lock `node_modules/micromatch` v4.0.8 (`dev=true`); `node_modules/fast-glob` v3.3.1 (`dev=true`); lock `@next/eslint-plugin-next` deps `fast-glob:3.3.1`; `package.json:141` | Транзитивные dev-зависимости линтера (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`). В коде проекта не вызываются: `grep -rn "\bglob(\|micromatch\|fast-glob" src/ scripts/` → только `scripts/verify-orion-equipment-pdfs.py:77` (Python `.glob()`, другой рантайм) | Dev-only. В образ `app` не входит вообще; в `workers` вырезается prune-ом (`dev=true`); физически присутствует только в `migrate` (полный `npm ci`) | Ничего. `fast-glob` 3.3.3 существует, но обновление не лечит `braces` (см. находку 2) |
| 4 | мелочь | lock `node_modules/deepmerge-ts` v7.1.5 (`dev=false`), родитель `@prisma/config` 7.10.0 (`deps.deepmerge-ts = "7.1.5"` точно); advisory GHSA-ggr8-5vv4-36mx, range `<8.0.0` | Транзитивная (через `prisma → @prisma/config`). Единственная точка исполнения — загрузка `prisma.config.ts` (`prisma.config.ts:2 import { defineConfig } from 'prisma/config'`), в `src/` импортов `deepmerge-ts`/`prisma/config` нет (`grep` → пусто) | Для CVE нужен циклический объект; слияние идёт над собственным конфигом репозитория, внешнего ввода нет | Ничего срочного. Патч есть (`8.0.2`), но `@prisma/config` прибивает `7.1.5` **точно** — применится только с релизом Prisma, не override-ом |
| 5 | мелочь | lock `node_modules/mysql2` v3.15.3 (`dev=false`), родитель `prisma` (`deps.mysql2 = "3.15.3"` точно); advisory GHSA-3f6p-5ww8-9rcr (high, `<3.22.0`) + GHSA-rgwj-5xj2-c3m3 (moderate, `<=3.23.0`) | Транзитивная (через `prisma`). **Не импортируется**: `grep -rn "mysql2" src/ scripts/ prisma/` → 0 совпадений. Провайдер — PostgreSQL (`prisma/schema.prisma:7 provider = "postgresql"`), драйвер `@prisma/adapter-pg` (`src/lib/db.ts:13,98 PrismaPg`) | Нет MySQL-сервера и MySQL-пути: эксплуатировать нечего | Ничего. Патч есть (`3.24.5` стабильный, `>3.23.0`), но prisma прибивает `mysql2` точно `3.15.3` — откроется только вместе с prisma |
| 6 | мелочь | `Dockerfile:103` (`COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma`) | Образ `app` копирует **весь** scope `@prisma`, включая `@prisma/config`, но его зависимость `deepmerge-ts` — top-level `node_modules/deepmerge-ts`, которая в `app`-образ не копируется | `@prisma/config` в образе `app` физически есть, но неработоспособен: первый же `import 'prisma/config'` упал бы с `MODULE_NOT_FOUND` по `deepmerge-ts`. Плюс лишний вес неиспользуемых подпакетов (`studio-core`, `engines`, `dev`) | Сузить COPY до `client/client-runtime-utils/adapter-pg/driver-adapter-utils/debug` — правка `Dockerfile*`, вне моих прав |
| 7 | мелочь | `Dockerfile:15,61` (migrate-стадия берёт полный `node_modules` из `deps`); `Dockerfile.workers:29`; advisory `braces/micromatch/fast-glob` | Контейнер `migrate` (единственный, где `braces`/`micromatch`/`fast-glob` физически присутствуют — через полный `npm ci`) выполняет только `npx prisma migrate deploy` (`docker-compose.yml:29-40`) и живёт ~секунды при деплое | Линтерный код в migrate не исполняется; риска нет, но состав образа объясняет, почему часть advisories «видна» в проде | Ничего. Достаточно знать: `braces` живёт только в `migrate`-образе |
| 8 | мелочь | `package.json:146`; `scripts/deploy-prod.sh:37-44,63-91`; отсутствие ссылок на `deploy/Dockerfile.prod` и `Dockerfile.quick` (grep по репо → только текст отчёта R62) | Боевой сборщик `scripts/deploy-prod.sh` собирает **только** `Dockerfile` (target `runner`/`migrate`) и `Dockerfile.workers` (target `runner`). `deploy/Dockerfile.prod` и `Dockerfile.quick` ни одним compose/скриптом/CI не используются | Ловушка аудита: `deploy/Dockerfile.prod:43` делает `npm prune --production`, а `Dockerfile.quick:7` — `npm ci` без `--ignore-scripts`; проверка состава образа по ним дала бы неверный ответ | Не удалял (решение владельца). Заметка: сверять только по `Dockerfile` и `Dockerfile.workers` |

### Сводная таблица «пакет → где он есть»

| пакет | версия в локе | прямой/транзитивный | путь зависимости | в образе продакшена | импорт в коде | вердикт |
|---|---|---|---|---|---|---|
| `braces` | 3.0.3 (`dev=true`) | транзитивный | `eslint-config-next` (devDep) → `@next/eslint-plugin-next` → `fast-glob` 3.3.1 → `micromatch` 4.0.8 → `braces` | app — нет; workers — **нет** (prune, `dev=true`); migrate — **да** (полный `npm ci`), но не исполняется | вызовов нет (`grep` → только слово «braces» в комментарии `src/services/telemetry/device-key-service.ts:134`) | **в продакшене не достижим** |
| `micromatch` | 4.0.8 (`dev=true`) | транзитивный | `@next/eslint-plugin-next` → `fast-glob` → `micromatch` | app — нет; workers — нет; migrate — да | вызовов нет | **в продакшене не достижим** |
| `fast-glob` | 3.3.1 (`dev=true`) | транзитивный | `@next/eslint-plugin-next` → `fast-glob` (`package.json:141`) | app — нет; workers — нет; migrate — да | вызовов нет | **в продакшене не достижим** |
| `deepmerge-ts` | 7.1.5 (`dev=false`) | транзитивный | `prisma` → `@prisma/config` 7.10.0 (прибит точно `7.1.5`) | app — нет (top-level, не под `@prisma`, не трассируется); workers — **да** (prune сохраняет); migrate — **да** | нет (`prisma.config.ts:2` — только `prisma/config`; слияние внутри `@prisma/config`) | **в продакшене не достижим** (исполняется только в migrate, вход — свой конфиг) |
| `@prisma/config` | 7.10.0 (`dev=false`) | транзитивный | `prisma` → `@prisma/config` | app — **да физически** (`Dockerfile:103`), но нерабочий (нет `deepmerge-ts`); workers — да; migrate — да | нет прямых импортов в `src/` | **в продакшене не достижим** |
| `prisma` | 7.10.0 (`dev=false`; объявлен devDep `package.json:146`) | транзитивный в прод-дереве (опц. peer `@prisma/client`) | `@prisma/client` (opt peer `prisma:*`) → `prisma` | app — нет; workers — **да** (`Dockerfile.workers:53,71`); migrate — **да** | нет (`grep -rn "prisma" src/workers/` → пусто; рантайм использует `@prisma/client`+`adapter-pg`) | **в продакшене не достижим** (только CLI в migrate) |
| `mysql2` | 3.15.3 (`dev=false`) | транзитивный | `prisma` → `mysql2` (прибит точно `3.15.3`) | app — нет; workers — **да**; migrate — **да** | **не импортируется** (`grep -rn "mysql2" src/ scripts/ prisma/` → 0) | **в продакшене не достижим** |
| `eslint-config-next` | 16.3.6 (`dev=true`) | прямой devDep (`package.json:141`) | — | app — нет; workers — нет; migrate — да | только конфиг линтера | **в продакшене не достижим** |

### Доступность патча (только чтение реестра)

| пакет | текущая | последняя стабильная | патч без `--force`? |
|---|---|---|---|
| `braces` | 3.0.3 | **3.0.3** | **нет** (advisory range `<=3.0.3` = максимум; релиза-фикса нет) |
| `micromatch` | 4.0.8 | 4.0.8 | нет (через `braces`) |
| `fast-glob` | 3.3.1 | 3.3.3 | есть, но `braces` не лечит |
| `deepmerge-ts` | 7.1.5 | 8.0.2 | есть, но `@prisma/config` прибивает `7.1.5` точно |
| `mysql2` | 3.15.3 | 3.24.5 | есть, но `prisma` прибивает `3.15.3` точно |
| `prisma` | 7.10.0 | **7.10.0** | **нет** в ветке 7.x (последняя стабильная = установленной) |
| `eslint-config-next` | 16.3.6 | 16.4.0 | есть, но обновление не снимает advisory (цепочка `braces`) |

Единственные фиксы, предлагаемые `npm audit` (`fixAvailable`), — **мажорные откаты**:
`prisma → 6.19.3`, `eslint-config-next → 14.2.35`, оба `isSemVerMajor: true`. Запускать
`npm audit fix --force` нельзя (ломает Prisma 7).

## Не проверено

- **Трассировка рантайма `app`-образа (`.nft.json`).** В `wt-audit-0f53` нет каталога `.next`
  (`ls -d .next` → пусто), поэтому точный список файлов `.next/standalone` не измерен. Вывод
  «`mysql2`/`deepmerge-ts` в `app` не попадают» опирается на детерминированный факт из
  `Dockerfile:95-104` (в `app` копируются только `standalone`, `static`, `public`, `prisma`,
  scope `@prisma` и `src/generated`; top-level `node_modules/mysql2` и
  `node_modules/deepmerge-ts` ни одним COPY не копируются) и на измерения R62 (384 `.nft.json`,
  0 ссылок). Реальная сборка/`docker build` не запускалась (запрещено).
- **Сборка `docker build`/`npm prune` не выполнялась.** Состав образов `workers` и `migrate`
  выведен из текста стадий и флагов `dev` в локе, а не из содержимого готовых образов.
- **`migrate`-контейнер читал только по тексту** `docker-compose.yml:23-55` и `Dockerfile:54-68`.
- **`scripts/deploy-prod.sh` не запускался** (только читал строки 1-143); `smoke-workers-image.sh`
  не открывал.
- **Цепочка `braces` в других локальных версиях** (`micromatch` 4.0.8 → `braces ^3.0.3`):
  проверено по лок-файлу, но `npm view micromatch dependencies` отдельно не запрашивал.

## Приложение: сравнение

Сначала этот отчёт (W153), затем сравнение с более ранними.

- **R62-npm-audit-reach.md** (4 high: `deepmerge-ts`, `mysql2`) — выводы **совпадают**:
  оба пакета не достижимы в рантайме, `mysql2` приходит через `prisma` и не используется
  (провайдер PostgreSQL), `deepmerge-ts` исполняется только в migrate при загрузке
  `prisma.config.ts`. Версии в R62 те же (`deepmerge-ts 7.1.5`, `mysql2 3.15.3`,
  `prisma 7.10.0`). **Добавлено в W153:** замер доступности патча в реестре — `deepmerge-ts`
  8.0.2 и `mysql2 3.24.5` существуют, но прибиты точно в `@prisma/config`/`prisma`, т.е.
  сами по себе не применимы.
- **W90-NPM-AUDIT-DIRECT-VS-TRANSITIVE.md** (12 high, все разобраны) — счёт `high` **совпал
  (12)** и версии совпали. W90 относит `braces` к «мелочи» и советует «обновится само при
  обновлении eslint-config-next»; **W153 это уточняет:** патча у `braces` нет вообще
  (advisory `<=3.0.3` = последний релиз), «само» не обновится — рекомендация W90 по этой
  строке неверна. По `deepmerge-ts`/`mysql2` выводы W90 и R62 согласуются с W153.
- **Новое относительно обоих отчётов:** явный замер `npm view <pkg> versions`
  (таблица «Доступность патча»), подтверждение, что `prisma` 7.x с исправленным
  `@prisma/config` **пока не выпущен** (последняя стабильная = 7.10.0), и что `braces`
  фикс-релиза не имеет.
