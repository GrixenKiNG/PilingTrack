# Runbook: PostgreSQL Down

| Metadata | Value |
|----------|-------|
| **Severity** | 🔴 P0 — Critical |
| **Impact** | Все записи заблокированы, чтение частично через cache |
| **SLA** | Восстановление < 15 мин |
| **Owned by** | Whoever holds prod SSH |

> **Стек:** одиночный VPS, Docker Compose (`/opt/pilingtrack`). НЕ Kubernetes.

```bash
cd /opt/pilingtrack
alias dc='docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml'
```

---

## Симптомы

- API возвращает 500 на write-операции
- `/api/health/deep` → `503`, поле `database: "down"`
- Логи app: `Connection refused`, `ECONNREFUSED`
- `dc ps postgres` показывает контейнер не `healthy` / перезапускается

---

## Диагностика

```bash
# 1. Статус контейнера
dc ps postgres

# 2. Логи postgres
dc logs postgres --tail 100

# 3. Жив ли сервер
dc exec postgres pg_isready -U piling -d pilingtrack

# 4. Место на диске — самая частая причина на этом VPS (30 GB)
df -h /
docker system df
```

---

## Восстановление

### Вариант 1 — контейнер упал: перезапуск

```bash
dc restart postgres
# Дождаться healthy
for i in $(seq 1 20); do
  s=$(docker inspect --format='{{.State.Health.Status}}' pilingtrack-postgres 2>/dev/null || echo starting)
  echo "[$i] $s"; [ "$s" = healthy ] && break; sleep 2
done
```

### Вариант 2 — диск полон: очистка

Postgres останавливается когда некуда писать WAL. Сначала освободить место
Docker'а (НЕ трогать каталог данных postgres вручную):

```bash
df -h /
docker builder prune -af      # ~2 GB кэша сборки
docker image prune -af        # висячие образы
# WAL-архив PITR тоже может пухнуть — проверить размер
sudo du -sh /opt/pilingtrack/wal-archive/
dc restart postgres
```

> ⚠️ НЕ удаляйте файлы в каталоге данных postgres руками
> (`pg_wal/` и т.п.) — это превратит recoverable-ситуацию в потерю БД.
> Если диск забил именно WAL внутри PGDATA — это симптом залипшего
> `archive_command`, см. runbook 009 (PITR), раздел failure modes.

### Вариант 3 — повреждение данных: восстановление из бэкапа

У нас ДВА механизма (см. runbook 006 и 009):
- **PITR** (runbook 009) — восстановление на любую секунду, предпочтительно
- **Ночной `pg_dump`** (runbook 006) — суточная гранулярность, запасной путь

Не импровизируйте здесь — идите в runbook 009 (PITR restore), там полная
проверенная процедура с остановкой app, разворотом базового бэкапа и
replay WAL.

---

## Проверка

```bash
# Соединение + данные на месте
dc exec postgres psql -U piling -d pilingtrack -c \
  'SELECT 1; SELECT count(*) FROM "Report";'

# Здоровье через приложение
curl -s https://orionpiling.ru/api/health/deep
# database должно быть "ok", overall status 200
```

---

## Post-Incident

- [ ] Root cause (диск? OOM? повреждение?)
- [ ] Если диск — настроить алерт раньше (см. Prevention)
- [ ] Обновить этот runbook если шаги изменились

---

## Prevention

- **Disk alert** при > 80% (Prometheus host disk alert уже есть — M-10)
- **Бэкапы:** ночной pg_dump (006) + PITR (009), оба активны
- **Свободное место:** на этом VPS 30 GB регулярно тесно — `df -h /`
  перед каждой сборкой
