# Проверка production-кандидата — 04.11.2026

## Вердикт: BLOCKED

Проверен candidate HEAD `d11822b1413fd6f3d6538c0e55ec956606cb8700` (ветка `codex/production-readiness-candidate`). TypeScript, lint, unit, Playwright discovery и специализированные PostgreSQL integration-тесты прошли. Полный build не проверен: валидатор останавливает команду до Next.js из-за отсутствующих обязательных env. Это не PASS и не production-сертификация.

## Матрица проверок итогового HEAD

| Проверка | Команда | Exit | Фактический результат | Журнал в SDD workspace |
| --- | --- | ---: | --- | --- |
| Очистка route types | `rm -rf .next/dev/types` | 0 | Выполнено перед первым tsc | — |
| TypeScript | `npx tsc --noEmit` | 0 | Ошибок нет | `tsc-final.txt` |
| Lint | `npm run lint` | 0 | ESLint и text integrity passed; 0 warnings | `lint-final.txt` |
| Полный unit-suite | `npm run test:unit` | 0 | 519 files passed + 21 skipped; **5892 passed, 290 skipped, 0 failed** | `unit-final.txt` |
| Playwright discovery | `npx playwright test --list` | 0 | **429 tests in 31 files**; baseline также 429/31 | `playwright-final.txt` |
| Build | `npm run build` | 1 | Остановлен до `next build`: нет `DATABASE_PROVIDER`, `SESSION_SECRET` | `build-final.txt` |
| ПТО integration без DB-env | `npx vitest run <3 integration files>` | 0 | 3 files / **9 skipped**; не засчитано как проверка | `pto-integration.txt` |
| ПТО integration на disposable PostgreSQL | `test-db-up.sh` + тот же Vitest + `test-db-down.sh` через trap | 0 | 3 files / **9 passed, 0 skipped, 0 failed** | `pto-integration-final.txt` |
| GitNexus compare с `main` | `node .gitnexus/run.cjs detect-changes --scope compare --base-ref main --repo .` | 0 | 46 files, 32 symbols, 19 flows, critical; без partial/truncated | `gitnexus-compare.txt` |

SDD workspace: `.superpowers/sdd/2026-11-04-production-readiness-candidate/`.

## Специализированные integration-тесты

Фактически выполнены:

- `pile-journal-pto.integration.test.ts` — 4/4;
- `pile-journal-order.integration.test.ts` — 3/3;
- `pile-journal-acts-accepted.integration.test.ts` — 2/2.

Стенд создавался штатным `scripts/test-db-up.sh`: отдельный Docker PostgreSQL 18, база `codex_test`, случайные одноразовые credentials, 115 существующих миграций через `prisma migrate deploy --config prisma.integration.config.ts`, приложение под не-superuser/non-BYPASSRLS role. После каждого прогона собственный контейнер удалялся через trap/`test-db-down.sh`. Основная и production БД не использовались. Два старых labelled-контейнера от 30–31.10.2026 обнаружены, но не принадлежат этому прогону и не удалялись.

Проверены реальные Prisma/SQL/RLS и формирование XLSX, включая недоступность чужого tenant/site и отсутствие чужих свай в шести выгрузках. Это не заменяет полный integration-suite, HTTP/browser и production-проверки.

## Найденные проблемы проверочного контура

1. Первый запуск на PostgreSQL дал 8 failed / 1 passed: скопированный generated Prisma runtime не знал `PilePassport.joints`.
2. Обычная повторная генерация не устранила failure: старые `client.js -> index.js` от прежнего генератора оставались рядом с новым `client.ts` и перехватывали runtime import.
3. Удалён только ignored `src/generated/postgres-client`; клиент заново сгенерирован из candidate-схемы через `prisma.integration.config.ts`. После этого исходная Prisma-ошибка исчезла. Schema/migrations не изменялись.
4. Оставшийся тест формы 2.5 падал из-за селектора `typeof r[0] === 'number'`: он включал строку номеров колонок `[1, 2, …]`. В commit `d11822b1` селектор ограничен строками `ORD-*`; ожидаемый SQL-порядок и продуктовый код не изменены. RED (1 failed/8 passed) → GREEN (9/9).

Таким образом, ранее задокументированный workaround с копированием `src/generated` заменён фактической чистой генерацией. Обычная `npm run db:generate` без env по-прежнему недоступна; это не скрывается.

## Ограничения и блокеры

- **Build / Next route types:** не проверены из-за отсутствия `DATABASE_PROVIDER` и `SESSION_SECRET`. Env не выдумывались, `.env*` не читались/не создавались. Дополнительные warnings: нет `REDIS_URL` (in-memory rate limit) и `SENTRY_AUTH_TOKEN`.
- **Unit skips:** 290 тестов в 21 файле пропущены. Они не считаются passed; отдельно закрыты только 9 целевых ПТО-сценариев.
- **Playwright:** выполнен только `--list`, реальные браузерные сценарии ещё не запускались.
- **GitNexus:** полный compare завершился без partial/truncated, но оценивает diff как critical из-за 32 symbols и 19 affected flows. Успешные статические проверки не отменяют необходимость runtime/browser review.
- Не выполнялись production deploy/SSH/DB, Lighthouse/Core Web Vitals, физические мобильные устройства, нагрузочное тестирование, R2 versioning/replication и внешний penetration test.

## Решение по следующему этапу

Согласно плану browser-этап не начинается при BLOCKED. Сначала владельцу/уполномоченному инженеру нужно предоставить корректное локальное/CI-окружение для полного `npm run build` без подмены секретов. После получения build PASS можно отдельно запускать browser/performance/production-контур на том же зафиксированном candidate или на новом пересобранном кандидате.
