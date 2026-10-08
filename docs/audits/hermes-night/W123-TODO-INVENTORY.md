# W123 — Опись меток TODO / FIXME / HACK / XXX в коде (`src/`, `scripts/`, `prisma/`, `e2e/`)

## Итог

- В авторском коде — ровно **1** метка: `src/app/api/metrics/__tests__/route.test.ts:9` (`TODO`, theme «прочее»). Это не задача, а ссылка в doc-комментарии на TODO `M-10b`, который уже закрыт (commit `64228fc`, `observability/prometheus/prometheus-prod.yml:24` — «M-10b done»). Дата строки по blame — 2026-07-04 (96 дней).
- По видам (авторский код): `TODO` — 1, `FIXME` — 0, `HACK` — 0, `XXX` — 0.
- По темам: **безопасность — 0**, **данные — 0**, производительность — 0, интерфейс — 0, прочее — 1 (устаревшая ссылка).
- По severity: **критично — 0**, **важно — 0**, **мелочь — 1**.
- Ещё 6 меток `TODO` лежат в сгенерированном Prisma-клиенте `src/generated/postgres-client/**` (каталог в `.gitignore`, git не отслеживает; не наш код).
- Ложное срабатывание: `scripts/app-guard.sh:174` — это не метка, а шаблон `mktemp` (`...XXXXXX`), плюс совпадения внутри base64/бинарных файлов `src/generated` (не наш код).
- `prisma/` и `e2e/` — **0** меток.
- Топ-5: (1) единственная авторская метка — устаревшая, вводит в заблуждение; (2)–(?) 6 шаблонных `TODO` в generated; (?) ложные совпадения `XXXXXX`/base64. Больше в области задачи ничего нет.
- Причина чистоты: правило ESLint `no-warning-comments` (`eslint.config.mjs:57`, `terms: ["todo","fixme","hack","xxx"]`, `location: "start"`) — падает только на комментарий, *начинающийся* с метки. Единственная выжившая авторская метка стоит в середине фразы («see the TODO M-10b»), поэтому под правило не попала.
- Сверка с прошлой описью: `docs/audits/hermes-night/W87-TODO-INVENTORY.md` (только `src/`) дала тот же вывод; W123 расширяет область на `scripts/`, `prisma/`, `e2e/` и подтверждает, что и там меток нет.

## Методика

Всё только чтение; ни один существующий файл не менялся. Команды воспроизводимы из корня `D:\PillingR\wt-night` (Git Bash).

1. Точный поиск по области задачи (учёт регистра, без `node_modules`/`.next`), через git (только отслеживаемые файлы):
   `git grep -n -I -E 'TODO|FIXME|HACK|XXX' -- 'src' 'scripts' 'prisma' 'e2e'`
2. Тот же поиск без учёта регистра и по всему репозиторию: `rg -n -I -i -e 'todo|fixme|hack|xxx' -g '!node_modules' -g '!.next' -g '!.git' .`
3. Сырой `grep -rniE` по `src scripts prisma e2e` (иначе, в отличие от git/rg, он НЕ уважает `.gitignore`, поэтому ловит и `src/generated`).
4. Проверка, что `src/generated` — не наш код: каталог в `.gitignore:96`, `git ls-files src/generated` → 0.
5. Расширенный поиск слов той же смысловой группы (вне обязательных четырёх меток), чтобы не пропустить «долг» под другим словом: `NOTE|WARNING|BUG|OPTIMIZE|REVIEW|DEPRECATED|TBD`, а также `костыл|заглушк|временн|на будущее|пока что|FIXE|TBD`.
6. Дата строки: `git blame -L 9,9 --date=short -- src/app/api/metrics/__tests__/route.test.ts`.
7. Контекст метки: чтение `src/app/api/metrics/__tests__/route.test.ts:1-18`; судьба TODO `M-10b`: `grep -rn 'M-10b'` (нашлась строка «M-10b done»).
8. Причина отсутствия меток: чтение правила в `eslint.config.mjs:55-57`.

## Сводка по видам и темам (авторский код, без `src/generated`)

```
вид    количество        тема            количество
TODO        1            безопасность        0
FIXME       0            данные              0
HACK        0            производительность  0
XXX         0            интерфейс           0
                         прочее              1
```

Распределение по каталогам области: `src/` (без generated) — 1; `scripts/` — 0 (единственное совпадение `XXXXXX` — не метка); `prisma/` — 0; `e2e/` — 0.

### Темы «безопасность» и «данные» — полностью

Меток тем «безопасность» и «данные» в области задачи **не найдено (0/0)** — проверено командами из §Методики, пп. 1–3. Ни одна из четырёх групп меток в `src/` (без `src/generated`), `scripts/`, `prisma/`, `e2e/` не относится к безопасности или целостности данных.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|----------|-----------|----------|--------------------------|--------------------------|
| 1 | мелочь | `src/app/api/metrics/__tests__/route.test.ts:9` | Doc-комментарий утверждает, что там «остался TODO M-10b» («see the TODO M-10b left there»), хотя TODO уже закрыт | Вводит в заблуждение: читатель идёт искать несуществующую задачу; номер `M-10b` теперь означает «сделано» (`observability/prometheus/prometheus-prod.yml:24`), на поведение кода не влияет | Переписать прошедшим временем (был TODO → закрыт в `64228fc`) либо убрать оборот «see the TODO … left there» |
| 2 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/client.d.ts:1838` | Шаблонный `TODO: count does not actually exist in DMMF` в сгенерированном клиенте Prisma | Не наша разработка: каталог `src/generated/**` в `.gitignore:96`, `git ls-files src/generated` → 0; править нельзя | Ничего не делать — это вывод генератора Prisma |
| 3 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/client.d.ts:2463` | Шаблонный `/** TODO what is this */` | То же | Ничего не делать |
| 4 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/client.d.ts:2465` | Шаблонный `/** TODO what is this */` | То же | Ничего не делать |
| 5 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/library.d.ts:2404` | Шаблонный `TODO: count does not actually exist in DMMF` | То же | Ничего не делать |
| 6 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/library.d.ts:2935` | Шаблонный `/** TODO what is this */` | То же | Ничего не делать |
| 7 | мелочь (информ., не наш код) | `src/generated/postgres-client/runtime/library.d.ts:2937` | Шаблонный `/** TODO what is this */` | То же | Ничего не делать |
| 8 | не находка (ложное срабатывание) | `scripts/app-guard.sh:174` | `mktemp "$STATE_DIR/.app-guard.state.XXXXXX"` — `XXXXXX` это обязательный шаблон `mktemp`, а не метка | Не дефект; включено, чтобы опись была воспроизводимо полной | Ничего не делать |

### Приложение: сырой список всех совпадений в области (для перепроверки)

Текстовые (не бинарные) совпадения в `src/ scripts/ prisma/ e2e/` — ровно 8 строк:

```
src/app/api/metrics/__tests__/route.test.ts:9                                              (метка #1, наш код)
src/generated/postgres-client/runtime/client.d.ts:1838                                     (шаблон Prisma)
src/generated/postgres-client/runtime/client.d.ts:2463                                     (шаблон Prisma)
src/generated/postgres-client/runtime/client.d.ts:2465                                     (шаблон Prisma)
src/generated/postgres-client/runtime/library.d.ts:2404                                    (шаблон Prisma)
src/generated/postgres-client/runtime/library.d.ts:2935                                    (шаблон Prisma)
src/generated/postgres-client/runtime/library.d.ts:2937                                    (шаблон Prisma)
scripts/app-guard.sh:174                                                                   (шаблон mktemp, не метка)
```

Плюс совпадения внутри бинарных/base64-файлов `src/generated/postgres-client/**` (`*.wasm`, `*.dll.node`, `query_compiler_fast_bg.wasm-base64.js`) — случайные байтовые последовательности, не метки.

## Не проверено

- **Метки в нелатинской записи и слова-синонимы** (`TBD`, `@todo`, «сделать позже», «не забыть» и т.п.) — систематически не инвентаризировал: задача ограничена четырьмя метками `TODO/FIXME/HACK/XXX`. Расширенный поиск (Методика, п.5) выполнен, найденные `NOTE`/`WARNING`/«временно недоступно»/«заглушка» относятся к доменным уровням и текстам UI/тестов, а не к меткам долга; их не оценивал.
- **Смысловые «долги» без слова-метки** (комментарии вида «упрощение», «временное решение») — не классифицировал: вне формата задачи, требует отдельного ревью.
- **Реальные дефекты, скрытые за метками** — не аудировал: задача про опись; единственная авторская метка дефекта не описывает (проверено, см. #1).
- **Даты для 6 меток в `src/generated`** — недоступны: каталог не отслеживается git (`.gitignore:96`), `git blame` по нему не работает.
- **Файлы вне области** (`docs/`, `Dockerfile`, `deploy/Caddyfile.prod`, `eslint.config.mjs`, `package-lock.json`) — в задачу не входили; попутно там есть слова `TODO/XXX`, но это документация/шаблоны/лок-файл, не код приложения. Не оценивал.
- **Правка кода** — намеренно не выполнялась (задача только на чтение).
