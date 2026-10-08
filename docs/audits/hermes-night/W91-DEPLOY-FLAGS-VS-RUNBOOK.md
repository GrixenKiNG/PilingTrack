# W91 — команды выкладки в ранбуках против `scripts/deploy-prod.sh`

## Итог

- `scripts/deploy-prod.sh` понимает ровно ОДИН флаг — `--replace-worker-generation`, и только первым
  аргументом (`scripts/deploy-prod.sh:30`); позиционные аргументы — подмножество `{app, migrate, workers}`
  (`:38-43`), лишний/неизвестный сервис → `die`; читает переменные `DEPLOY_HOST` (`:24`), `DEPLOY_KEY`
  (`:25`), `WORKER_GENERATION_EXTERNAL_STOPPED` (`:52`), `SKIP_WORKERS_SMOKE` (`:66`).
- В `docs/runbooks/` всего ТРИ команды `bash scripts/deploy-prod.sh …` — `008:117`, `008:310`, `016:58`.
  Все три совпадают со скриптом: флаг стоит первым, сервисы `app workers`, `WORKER_GENERATION_EXTERNAL_STOPPED=1`
  действительно читается. **Расхождений в самих deploy-командах нет.**
- Счёт по severity: критично — 0, важно — 2, мелочь — 2. Все расхождения — не в самих deploy-prod-командах,
  а в соседних командах выкладки/ручного пути внутри тех же ранбуков.
- Топ: (1) ранбук 007 предлагает выбрать сервис `ws`, которого нет ни в `deploy-prod.sh`, ни в
  `.github/workflows/deploy.yml`; (2) команды `docker compose … ws` (006:91, 006:118) и
  `docker compose stop app workers workers-pdf ws` (009:182) — таких сервисов нет ни в одном compose-файле,
  команда упадёт целиком; (3) ручной путь 008 вызывает `replace-worker-generation.sh` напрямую
  (110/168/303) — это другой скрипт с другим набором предусловий.
- Ранбук 013 (`:72`, `:85`) описывает логику откатных тегов deploy-prod.sh корректно — расхождений нет.

## Методика

1. Индекс: `search_files deploy-prod\.sh` по всему репозиторию (45 совпадений) — отобраны все файлы
   `docs/runbooks/*`; отдельно `search_files 'bash scripts/'` и `WORKER_[A-Z_]+|SKIP_WORKERS_SMOKE|DEPLOY_HOST|DEPLOY_KEY|\bws\b`
   по `docs/runbooks/`.
2. `scripts/deploy-prod.sh` прочитан целиком (143 строки): найдены `case` (`:38-43`), разбор `$1` (`:30`),
   `SERVICES=("$@")` (`:31`), проверки предусловий (`:49-61`), чтение переменных окружения.
3. Каждая команда `bash scripts/deploy-prod.sh …` из ранбуков сверена по трём осям: (а) известен ли флаг,
   (б) порядок (флаг первым), (в) читается ли переменная окружения перед командой.
4. Для контроля «сервисов, которых нет»: `search_files` по `docker-compose*.yml` на определения сервисов
   (`app|workers|migrate|postgres|redis|ws|workers-pdf`) и чтение `docker-compose.yml`/`.prod.yml`/`.staging.yml`.
5. Дополнительно прочитаны `.github/workflows/deploy.yml` (какие сервисы принимает ручной деплой по кнопке)
   и `scripts/replace-worker-generation.sh` (какие переменные/аргументы читает helper): `:62`,
   `WORKER_GENERATION_EXTERNAL_STOPPED` `:64`, `WORKER_GENERATION_STOP_TIMEOUT_SECONDS` `:85`, `:67` (только `app|workers`).

## Находки

| # | severity | файл:строка | команда | что не совпадает | как исправить |
|---|---|---|---|---|---|
| 1 | важно | `docs/runbooks/007-github-actions-deploy.md:41-42` | выбор сервисов `app workers ws`, `ws` | Ранбук 007 предлагает сервис `ws`, которого НЕТ ни в `scripts/deploy-prod.sh` (`case` `:38-43` знает только `app/migrate/workers`; шапка `:6` «ws отсутствует»), ни в `.github/workflows/deploy.yml` (options `:18-21` — только `app`, `app workers`, `workers`; сверка `:41` отвергает прочее). Сервис `ws` снят 26.09.2026, ранбук не обновлён. Оператор, выбравший «ws», получит ошибку. | Удалить строки про `ws` из списка сервисов в 007 и оставить `app`, `app workers`, `workers`. |
| 2 | важно | `docs/runbooks/006-postgres-backup-restore.md:91,118`; `docs/runbooks/009-pitr-restore.md:182` | `docker compose stop app workers ws` / `docker compose up -d app workers ws` / `docker compose stop app workers workers-pdf ws` | Команды передают сервисы `ws` и `workers-pdf`, которых нет ни в `docker-compose.yml`, ни в `docker-compose.prod.yml`, ни в `docker-compose.staging.yml` (там только `migrate/app/workers/postgres/redis`). Docker Compose v2 валидирует имена сервисов и падает целиком, а не игнорирует лишний — при восстановлении БД первый же шаг («остановить писателей») не сработает. | Убрать `ws` и `workers-pdf` из этих строк: `docker compose stop app workers` и `docker compose up -d app workers`. |
| 3 | мелочь | `docs/runbooks/008-manual-deploy.md:110,168,303`; `docs/runbooks/016-release-2026-10.md:118` | `WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/replace-worker-generation.sh app workers` | В разделах «Deploy»/«Rollback» вызывается helper `replace-worker-generation.sh`, а не `deploy-prod.sh`. Это другой скрипт: не собирает образы, не ставит откатный тег, не гоняет smoke и не проверяет `main/origin/main` (`deploy-prod.sh:57-61`). Для ручного запасного пути 008 это задумано, но два входа имеют РАЗНЫЙ набор предусловий, и это нигде явно не сказано. | Добавить в 008/016 одну фразу: «`replace-worker-generation.sh` — только барьер смены поколения поверх уже собранных образов; полная выкладка (сборка/smoke/теги) — `deploy-prod.sh`». |
| 4 | мелочь | `docs/runbooks/007-github-actions-deploy.md:53-55` | «The manual `ssh + docker compose` runbook in CLAUDE.md still works» | Ссылка на ручной путь `ssh + docker compose` в `CLAUDE.md` устарела: `CLAUDE.md:32` описывает выкладку через `WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers`, а не через ручной `ssh + docker compose`. | Заменить ссылку на `docs/runbooks/008-manual-deploy.md` и актуальную команду `deploy-prod.sh`. |

Проверенные и НЕ являющиеся расхождением команды (для полноты):

| файл:строка | команда | вердикт |
|---|---|---|
| `docs/runbooks/008-manual-deploy.md:117` | `WORKER_GENERATION_EXTERNAL_STOPPED=1 bash scripts/deploy-prod.sh --replace-worker-generation app workers` | совпадает: флаг `--replace-worker-generation` известен (`:30`) и стоит первым; `app workers` — валидные сервисы (`:38-43`); `WORKER_GENERATION_EXTERNAL_STOPPED` читается (`:52`) |
| `docs/runbooks/008-manual-deploy.md:310` | то же | совпадает (см. выше) |
| `docs/runbooks/016-release-2026-10.md:58` | то же | совпадает (см. выше); ранее в 016:33-36 корректно описан smoke без `SKIP_WORKERS_SMOKE` (`:66`) |
| `docs/runbooks/008-manual-deploy.md:118` | `SKIP_WORKERS_SMOKE=1` как аварийный обход | совпадает: скрипт читает `SKIP_WORKERS_SMOKE` (`:66`) |
| `docs/runbooks/008-manual-deploy.md:202,222` | `bash scripts/staging-local.sh --refresh-db` / `--down` | вне области deploy-prod.sh; аргументы `--refresh-db`/`--down`/`--destroy` — не проверялись (см. «Не проверено») |

## Не проверено

- `scripts/staging-local.sh` целиком не читался: его флаги (`--refresh-db`, `--down`, `--destroy`) не сверялись —
  это не `deploy-prod.sh`, вне прямого задания.
- `scripts/smoke-workers-image.sh` прочитан только по имени/вызову (`deploy-prod.sh:69`, `016:36`); его
  собственные аргументы и переменные не аудировались.
- Поведение на реальном сервере: ни одна команда не запускалась (запрещено правилами). Проверка — только
  статическое сопоставление текста ранбуков и скрипта.
- Расхождение №2 подтверждено чтением `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.staging.yml`;
  `docker-compose.monitoring-prod.yml` (отдельный файл в ранбуке 014) на наличие сервиса `ws` не проверялся.
- Не проверялось, не переопределяет ли оператор `WORKER_GENERATION_PROJECT` в окружении перед `deploy-prod.sh`:
  скрипт задаёт его жёстко (`:114`, `WORKER_GENERATION_PROJECT=pilingtrack`) и внешнее значение игнорируется —
  в ранбуках такой переменной нет, поэтому расхождения не заведено.
