---
name: deploy
description: Generate a ready-to-paste deploy command block for orionpiling.ru, auto-detecting whether a new Prisma migration needs to be included in the build.
---

# Deploy to orionpiling.ru

**Default path since 2026-09-23: `bash scripts/deploy-prod.sh [services...]`** (default `app workers`; add `ws` when ws-server changed). It builds images on the developer machine and ships them via `docker save | ssh docker load`, so the 30 GB VPS never hosts a build (a server-side workers build filled the disk to 100% on 2026-09-23). The script does the pre-flight (main, clean tree, HEAD in origin), auto-adds `migrate` for new migrations, keeps ONE rollback tag set, verifies health and prints the rollback command. A transient `Segmentation fault` in `prisma generate` inside the local Docker build is flaky — just re-run.

The server-side block below is the fallback (e.g. no local Docker). Before using it, check `df -h /` — need ≥ 8 GB free.

Generate a copy-paste deploy block for the production VPS.

## Steps

1. Run this command to detect new migrations since the last deployed commit:
```bash
git log --oneline -1 origin/main 2>/dev/null || git log --oneline -1
git diff --name-only HEAD~1..HEAD -- "prisma/migrations/**" 2>/dev/null
```

2. Check disk and recent changes:
```bash
git log --oneline -5
```

3. Based on whether there are new migration files, output ONE of the two blocks below. Be explicit about which case applies.

---

## Output format

Always output in Russian. Start with a one-line status, then the copy-paste block.

### Case A — нет новых миграций

```
Новых миграций нет — собираем app и workers.

cd /opt/pilingtrack
df -h /
# Пометить текущую версию перед пересборкой (мгновенный откат без пересборки):
OLD_COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y%m%d)
for svc in app workers; do docker tag pilingtrack-$svc:latest pilingtrack-$svc:$OLD_COMMIT-$DATE 2>/dev/null || true; done
git pull origin main
docker compose build app workers
docker compose up -d app workers
```

### Case B — есть новая миграция (новая папка в prisma/migrations/)

```
⚠️ Есть новая миграция — нужно пересобрать migrate тоже.

cd /opt/pilingtrack
df -h /
# Пометить текущую версию перед пересборкой (мгновенный откат без пересборки):
OLD_COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y%m%d)
for svc in app workers migrate; do docker tag pilingtrack-$svc:latest pilingtrack-$svc:$OLD_COMMIT-$DATE 2>/dev/null || true; done
git pull origin main
docker compose build migrate app workers
docker compose up -d app workers
# Проверь, что миграция применилась (не верь exit 0):
docker compose exec postgres psql -U piling -d pilingtrack \
  -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;"
```

### Откат на предыдущую версию (если что-то пошло не так)

```
OLD_COMMIT=<commit, который был тегирован перед деплоем>
DATE=<дата деплоя>
for svc in app workers; do docker tag pilingtrack-$svc:$OLD_COMMIT-$DATE pilingtrack-$svc:latest; done
docker compose up -d app workers
```
Это откатывает только **код** (контейнеры). Если деплой включал новую миграцию (Case B) — откат схемы БД отдельный и сложнее (`prisma migrate resolve`/восстановление из бэкапа), сначала смотри, действительно ли проблема в миграции.

### Case C — disk > 85%

Append this warning before the block:
```
⚠️ Диск заполнен >85% — сначала очисти builder cache:
docker builder prune -af
```

---

## Notes

- Never suggest `build app workers` in parallel if disk is near-full — sequential build required (see memory: prod deploy disk).
- The `migrate` service bakes prisma/migrations into its image at build time — if omitted, it silently says "No pending migrations" and exits 0 without applying.
- `ws` service changes are rare; only add it if websocket files were modified.
- **Always tag the old `:latest` image before building** (see commands above). `docker compose build` overwrites `:latest` immediately — without a pre-deploy tag, the old image is unrecoverable once pruned (`docker builder prune`/`docker image prune`), and rollback means a full rebuild from the old commit instead of an instant retag. Tagging is free disk-wise (shares layers, no copy). Hit this gap for real on 2026-06-30 — see [[project_prod_deploy_2026_06_30]].
- Before a deploy with new migrations, also run each pre-flight data-integrity check (duplicate rows, NULL columns the migration will reject, etc.) as a SEPARATE statement — a single combined query can silently no-op if one referenced column doesn't exist yet pre-migration, masking a real blocker (this is exactly how the 2026-06-30 deploy missed a duplicate-active-crew row until the migration failed live).
