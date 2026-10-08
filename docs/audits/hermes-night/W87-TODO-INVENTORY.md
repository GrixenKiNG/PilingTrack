# W87 — Инвентаризация меток TODO / FIXME / HACK / XXX в `src/`

## Итог

- Всего строк с метками в `src/`: **7** — в **3** файлах.
- Авторского (написанного руками) кода касается **1** метка: `src/app/api/metrics/__tests__/route.test.ts:9`. Это не действующая задача, а ссылка в doc-комментарии на TODO `M-10b`, который уже закрыт (`observability/prometheus/prometheus-prod.yml:24` — «M-10b done»).
- Остальные **6** — в сгенерированном клиенте Prisma `src/generated/postgres-client/**` (каталог в `.gitignore`, git не отслеживает; не наш код, править нельзя).
- По видам: `TODO` — 7, `FIXME` — 0, `HACK` — 0, `XXX` — 0.
- По severity: **критично — 0**, **важно — 0**, **мелочь — 1** (+6 информационных в generated).
- Меток старше 60 дней (порог 2026-08-09): **1** — от `2026-07-04` (96 дней).
- Топ-5: (1) единственная авторская метка — устаревшая, вводит в заблуждение; (2)–(6) — захардкоженные `TODO` внутри сгенерированного Prisma-клиента, вне нашего контроля.
- Причина такой чистоты: правило ESLint `no-warning-comments` (audit M-7) — `eslint.config.mjs:57`, `location: "start"`. Оно ругается только на комментарий, *начинающийся* с `todo/fixme/hack/xxx`; единственная выжившая авторская метка — в середине фразы («see the TODO M-10b»), поэтому под правило не попала. Каталог `src/generated/**` исключён из линта (`eslint.config.mjs:141`), поэтому 6 меток там никогда не проверялись.

## Методика

Всё только чтение, ничего в коде не менялось. Команды воспроизводимы из корня репозитория.

1. Поиск меток во всех файлах `src/` (без ограничения по расширению, чтобы не пропустить `.mdx/.css/.json`):
   `grep -rnE 'TODO|FIXME|HACK|XXX' src | grep -v node_modules`
2. Тот же поиск без учёта регистра и с исключением сгенерированного каталога:
   `grep -rniE 'TODO|FIXME|HACK|XXX' src | grep -v node_modules | grep -v 'src/generated'`
3. Проверка, что `src/generated` — не наш код: `git check-ignore -v src/generated/postgres-client/runtime/client.d.ts` (в `.gitignore:96`), `git ls-files src/generated` → 0.
4. Дата последнего изменения строки: `git blame -L <строка>,<строка> --date=short -- <файл>`.
5. Контекст: чтение комментария (`src/app/api/metrics/__tests__/route.test.ts:1-18`), проверка судьбы TODO `M-10b` (`observability/prometheus/prometheus-prod.yml:15-35`; `grep -rn 'M-10b'`).
6. Причина отсутствия меток: чтение `eslint.config.mjs:54-57` (правило `no-warning-comments`, `location: "start"`) и списка ignores `eslint.config.mjs:124-162` (`src/generated/**` исключён).
7. Возраст в днях: `node -e "…"` (сегодня 2026-10-08, порог 60 дней = 2026-08-09).

## Сводка по папкам верхнего уровня `src/`

```
папка              меток   из них авторских   что это
src/app                1           1          doc-комментарий в тесте metrics
src/generated          6           0          сгенерированный Prisma-клиент (gitignore)
src/components         0           0          —
src/core               0           0          —
src/lib                0           0          —
src/modules            0           0          —
src/services           0           0          —
src/workers            0           0          —
src/test               0           0          —
src/__tests__          0           0          —
прочее (proxy.ts, instrumentation*.ts)   0   0          —
ИТОГО                  7           1
```

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|----------|-----------|----------|--------------------------|--------------------------|
| 1 | мелочь | `src/app/api/metrics/__tests__/route.test.ts:9` | Doc-комментарий утверждает, что остался «TODO M-10b left there», хотя тот TODO уже закрыт | Вводит в заблуждение: читатель идёт искать несуществующую задачу; номер `M-10b` теперь означает «сделано» | Переписать фразу прошедшим временем (был TODO → закрыт в 64228fc) либо убрать «see the TODO … left there» |

### Метки старше 60 дней (порог 2026-08-09)

| файл:строка | текст метки | дата (git blame) | опасно? |
|-------------|-------------|------------------|---------|
| `src/app/api/metrics/__tests__/route.test.ts:9` | `* this (see the TODO M-10b left there), so metrics were never collected.` | 2026-07-04 | **нет** — метка не описывает незакрытую работу: TODO `M-10b` закрыт (`observability/prometheus/prometheus-prod.yml:24` «M-10b done»), строка лишь объясняет предысторию; на поведение кода не влияет |

### Приложение: метки в сгенерированном Prisma-клиенте (не наш код, git не отслеживает)

Каталог `src/generated/postgres-client/` игнорируется git (`.gitignore:96`), `git ls-files src/generated` → 0, поэтому дату по blame получить нельзя — это шаблонные строки из генератора Prisma.

| path:line | текст | опасно? |
|-----------|-------|---------|
| `src/generated/postgres-client/runtime/client.d.ts:1838` | `count = "count",// TODO: count does not actually exist in DMMF` | нет — сгенерированный код, вне нашего контроля |
| `src/generated/postgres-client/runtime/client.d.ts:2463` | `/** TODO what is this */` | нет — то же |
| `src/generated/postgres-client/runtime/client.d.ts:2465` | `/** TODO what is this */` | нет — то же |
| `src/generated/postgres-client/runtime/library.d.ts:2404` | `count = "count",// TODO: count does not actually exist in DMMF` | нет — то же |
| `src/generated/postgres-client/runtime/library.d.ts:2935` | `/** TODO what is this */` | нет — то же |
| `src/generated/postgres-client/runtime/library.d.ts:2937` | `/** TODO what is this */` | нет — то же |

## Не проверено

- **`git blame` для файлов в `src/generated`** — невозможно: каталог не отслеживается git (`.gitignore:96`). Дату этих 6 меток не устанавливал; это шаблон Prisma.
- **Метки в нелатинской записи (например «туду», «доработать») и слова-синонимы** (`NOTE`, `BUG`, `OPTIMIZE`, `@todo`, `@fixme`) — часть из них попалась при проверке (`NOTE:` встречается в `src/core/...`, `src/services/...`), но систематически инвентарь таких пометок не собирал, т.к. задача ограничена четырьмя метками `TODO/FIXME/HACK/XXX`.
- **Содержимое `src/generated` на предмет реальных дефектов** — не изучал: это сгенерированный код, задача про метки, а не про аудит Prisma.
- **Точный возраст строк с метками, добавленными не отдельным коммитом** — `git blame` показывает автора/дату последней правки *строки*; если TODO пережил переформатирование, дата может быть свежее фактического появления.
- **Файлы вне `src/`** — не входили в задачу. Попутно найдены метки в `deploy/Caddyfile.prod:64` (TODO) и `eslint.config.mjs:54` (упоминание в правиле); их не оценивал.
