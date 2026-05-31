---
name: deploy
description: Generate a ready-to-paste deploy command block for orionpiling.ru, auto-detecting whether a new Prisma migration needs to be included in the build.
---

# Deploy to orionpiling.ru

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
git pull origin main
docker compose build app workers
docker compose up -d app workers
```

### Case B — есть новая миграция (новая папка в prisma/migrations/)

```
⚠️ Есть новая миграция — нужно пересобрать migrate тоже.

cd /opt/pilingtrack
df -h /
git pull origin main
docker compose build migrate app workers
docker compose up -d app workers
# Проверь, что миграция применилась (не верь exit 0):
docker compose exec postgres psql -U piling -d pilingtrack \
  -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3;"
```

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
