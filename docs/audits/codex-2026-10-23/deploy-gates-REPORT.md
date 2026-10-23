# Задача A — обязательные CI и integration для выкладываемого SHA

Ветка: `codex/deploy-gates-1023`. Worktree: `D:/PillingR/wt-deploy-gates-1023`.
База: `064e2402dfddaa1a0b4ce6842fa1f113eec4b65e`.

## Изменение

Только `.github/workflows/deploy.yml`, шаг `Verify CI for requested SHA`: +8 / −6 строк. Одна и та же проверка теперь последовательно применяется к `ci.yml` и `integration.yml`. Для каждого обязателен последний запуск со всеми признаками: запрошенный полный SHA, ветка `main`, событие `push`, статус `completed`, результат `success`. Ошибка API и неверный JSON также закрывают ворота. Старый зелёный запуск не заменяет более новый красный.

Остальные шаги и поля workflow не менялись: проверено разбором YAML и deepEqual после исключения единственного изменённого шага. Удалённых файлов нет.

В текущем `integration.yml` нет `paths` / `paths-ignore`: запуск предусмотрен для push в main, PR в main и вручную. Ручной/PR-запуск не даёт разрешение на выкладку: нужен push в main. Если позднее добавят paths-фильтр и для SHA не будет запуска, ворота откажут. Ожидание ещё работающей интеграции также завершится отказом: после её успешного завершения владелец сможет снова запустить ручную выкладку.

## Проверки и настоящие коды возврата

| Проверка | Код | Результат |
| --- | ---: | --- |
| Исходный шаг с локальными ответами gh api, bash и настоящим jq 1.7 | 1 | 13 passed / 12 failed: integration вообще не проверялся |
| Исправленный шаг с теми же fixtures | 0 | 25 passed / 0 failed |
| `node scripts/test-deploy-workflow.cjs` | 0 | 33 существующих offline-сценария |
| `npx --no-install vitest run src/workers/__tests__/workers-image-smoke.test.ts` | 0 | 12 passed / 0 skipped / 0 failed, 1 файл |
| `npm run lint` | 0 | ESLint и проверка текстовой целостности |
| `npm run check:layers` | 0 | 4 ранее разрешённых исключения / 0 новых |
| Первая `npx --no-install tsc --noEmit` | 2 | В fresh worktree отсутствовал сгенерированный Prisma client; ошибки сохранены в tsc.log |
| Повторная `npx --no-install tsc --noEmit` | 0 | После подключения существующего generated client, tsc-with-client.log |
| Семантическое сравнение YAML вне указанного шага | 0 | Все остальные поля равны базе |
| `git diff --check` | 0 | Ошибок whitespace нет |

Fixtures запускаются в уже установленном образе `ghcr.io/openhands/agent-canvas:1.25.0`, с `--network none`, собственными bind mounts и `--rm`. `gh` — shell-функция: разрешает только два точных локальных пути API и возвращает синтетический JSON, никакого настоящего gh/GitHub. Настоящий jq находится в этом образе. Ни образ, ни зависимости не устанавливались. Docker-контейнер после каждого прогона удалён.

Матрица: оба зелёных; по каждому workflow — отсутствие запуска, failure, cancelled, skipped, in_progress, queued, чужой SHA, чужая ветка, другое событие, последний красный при более старом зелёном; неверный входной SHA; ошибка API для каждого workflow; повреждённый JSON integration. Скрипты `fixtures.cjs` и `fixtures.sh`, исходный/исправленный извлечённые шаги, JSON и логи лежат здесь.

Команды воспроизведения из этого worktree:

```powershell
node output/deploy-gates-1023/fixtures.cjs
docker run --rm --network none --mount type=bind,source=D:/PillingR/wt-deploy-gates-1023/output/deploy-gates-1023,target=/fixtures,readonly --mount type=bind,source=D:/PillingR/wt-deploy-gates-1023/output/deploy-gates-1023,target=/results --entrypoint /bin/bash ghcr.io/openhands/agent-canvas:1.25.0 /fixtures/fixtures.sh current-step.sh
node scripts/test-deploy-workflow.cjs
npx --no-install vitest run src/workers/__tests__/workers-image-smoke.test.ts
```

## GitNexus и ограничения

Применён skill `D:/PillingR/my-project/.agents/skills/gitnexus-impact-analysis/SKILL.md`. Собственный индекс от указанной базы: 32525 nodes / 71067 edges / 544 clusters / 1221 flows. Глобальная выборка execution flows ограничена бюджетами индексатора; отсутствие flow не доказывает отсутствие воздействия.

До изменения выполнен upstream impact по `.github/workflows/deploy.yml` с явным repo/worktree: `UNKNOWN`, target not found, exit 1. YAML-шаг не моделируется как функция; это не разрешение считать риск низким. Текстовый поиск выявил два существующих потребителя workflow (offline-скрипт и workers-image-smoke.test.ts); оба прогнаны. Влияние на выкладку проверено настоящим bash/jq на синтетических ответах.

Перед коммитом `detect_changes(scope=all, repo=<свой worktree>, worktree=<свой worktree>)`: 1 changed file, 0 моделируемых symbols / 0 affected processes, summary risk low; partial/truncated отсутствуют. Нулевые symbols относятся к неподдерживаемому YAML, а не доказывают безопасность: основное доказательство — 25 исполняемых fixtures и неизменность остальных шагов.

Зависимости подключены read-only junction из основной папки, без установки/изменений. Сгенерированный client подключён тем же способом после сравнения SHA256 обоих `prisma/schema.prisma` (равны). Схема БД не менялась. `.env*`, внешние credentials и production не читались/не менялись. Проверка schema hashes не читает секреты.

Полный unit-набор, Playwright collection/E2E и build не запускались: изменение касается только workflow, затронутые проверки перечислены выше. Полная приёмка приложения/физического устройства/production не заявляется. GitHub API, workflows и выкладка не запускались. Push/merge/deploy не выполнялись. output игнорируется Git, отчёт и локальные fixtures не входят в область source-коммита.

## Коммит

`c9c381b7d33204bc56df3653d8b22503f32dc924` — `fix(ci): require integration success before deployment`. Проверки проведены на том же дереве единственного изменения перед коммитом. Рабочее дерево после коммита чистое. Требуется независимое ревью владельцем/Claude; слияние только по команде владельца.


