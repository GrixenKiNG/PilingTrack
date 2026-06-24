# Disaster Recovery Plan — PilingTrack

| Metadata | Value |
|----------|-------|
| **Version** | 1.0 |
| **Date** | 2026-04-08 |
| **Author** | Core Team |
| **Review Cycle** | Quarterly |
| **Next Review** | 2026-07-08 |

---

## 1. Scope

Этот документ определяет план восстановления системы PilingTrack при катастрофических сбоях:
- Полная потеря PostgreSQL
- Corruption данных
- Региональный outage (cloud provider down)
- Ransomware / security breach

---

## 2. RTO/RPO Targets

| Метрика | Target | Текущая возможность |
|---------|--------|-------------------|
| **RTO** (Recovery Time Objective) | 15 мин | 30-60 мин |
| **RPO** (Recovery Point Objective) | 5 мин | 24 часа (daily backups) |
| **Availability** | 99.9% | Не измерено |

---

## 3. Backup Strategy

### Automated Backups

| Тип | Частота | Retention | Скрипт |
|-----|---------|-----------|--------|
| Daily | 02:00 UTC | 7 дней | `scripts/backup.sh` |
| Weekly | Воскресенье | 4 недели | `scripts/backup.sh` |
| Monthly | 1-е число | 12 месяцев | `scripts/backup.sh` |

### Backup Storage

| Location | Тип | Шифрование |
|----------|-----|------------|
| Local PVC | PersistentVolume | Нет |
| S3 | Cloud storage | AES-256 |
| Cross-region | Another region | AES-256 |

### Backup Verification

- **Daily**: Автоматическая проверка целостности (`pg_restore -l`)
- **Weekly**: Тестовое восстановление в staging
- **Monthly**: Full DR drill (см. Section 7)

---

## 4. Recovery Scenarios

### Scenario 1: PostgreSQL Crash (Single Node)

**Impact:** Все записи заблокированы, чтение через cache
**RTO:** 5-15 мин

**Steps:**
1. Перезапусти pod: `kubectl delete pod -l app=postgres`
2. Проверь целостность: `pg_isready`
3. Если не помогает — restore из backup (Scenario 2)

### Scenario 2: Full Database Loss

**Impact:** Все данные потеряны
**RTO:** 30-60 мин
**RPO:** До последнего backup

**Steps:**
1. **Объяви инцидент** — оповести команду
2. **Останови приложение** — предотврати запись в corrupted DB
   ```bash
   kubectl scale deployment pilingtrack-prod-api --replicas=0
   ```
3. **Восстанови из backup**
   ```bash
   ./scripts/backup.sh restore /backups/latest.dump
   ```
4. **Проверь целостность**
   ```bash
   psql -c "SELECT COUNT(*) FROM \"Report\";"
   ```
5. **Перезапусти приложение**
   ```bash
   kubectl scale deployment pilingtrack-prod-api --replicas=3
   ```
6. **Верифицируй** — health checks, SLO dashboard

### Scenario 3: Data Corruption

**Impact:** Данные неверны, финансовые ошибки
**RTO:** 1-2 часа
**RPO:** До точки corruption

**Steps:**
1. Определи точку corruption (анализ логов)
2. Восстанови из backup ДО точки corruption
3. Replay outbox events между backup и corruption point
4. Верифицируй integrity checks
5. Перезапусти приложение

### Scenario 4: Regional Outage

**Impact:** Полный outage региона
**RTO:** 2-4 часа
**RPO:** До последнего cross-region backup

**Steps:**
1. Переключи DNS на secondary region
2. Восстанови БД из cross-region backup
3. Разверни приложение в secondary region
4. Верифицируй все компоненты
5. Мониторь 24 часа перед переключением обратно

### Scenario 5: Security Breach

**Impact:** Компрометация данных
**RTO:** 4-8 часов
**RPO:** 0 (но данные могут быть украдены)

**Steps:**
1. Изолируй систему (network policies)
2. Смени все секреты (SESSION_SECRET, ENCRYPTION_KEY, DB password)
3. Восстанови БД из backup (предположительно clean)
4. Обнови все API tokens
5. Audit log анализ — что было затронуто
6. Перегенерируй все JWT (logout всех пользователей)

---

## 5. Communication Plan

### Incident Severity Levels

| Level | Description | Response Time | Communication |
|-------|-------------|---------------|---------------|
| **P0** | Full outage, data loss | < 15 мин | Telegram + Email + Phone |
| **P1** | Major degradation | < 30 мин | Telegram + Email |
| **P2** | Partial degradation | < 1 час | Telegram |
| **P3** | Minor issue | < 4 часа | Email |

### Communication Channels

1. **Telegram**: @pilingtrack-alerts (автоматические алерты)
2. **Email**: oncall@pilingtrack.com
3. **Phone**: On-call engineer (ротация)
4. **Status Page**: status.pilingtrack.com (public)

### Escalation Matrix

| Time | P0 | P1 | P2 |
|------|----|----|-----|
| 0-15 мин | On-call | On-call | On-call |
| 15-30 мин | Tech Lead | On-call | — |
| 30-60 мин | CTO | Tech Lead | — |
| 60+ мин | CEO | CTO | Tech Lead |

---

## 6. Recovery Scripts

| Скрипт | Назначение | Запуск |
|--------|-----------|--------|
| `scripts/backup.sh` | Backup/restore БД | Manual / Cron |
| `scripts/validate-env.ts` | Проверка конфигурации | Pre-deploy |
| `scripts/apply-full-ddl.sql` | Применение DDL | Post-restore |
| `scripts/encrypt-existing-bot-tokens.ts` | Миграция шифрования | One-time |
| `scripts/hash-existing-pins.ts` | Миграция PIN хеширования | One-time |

---

## 7. DR Drill Schedule

| Тип | Частота | Последний | Следующий |
|-----|---------|-----------|-----------|
| Backup restore test | Monthly | — | 2026-05-01 |
| Full DR drill | Quarterly | — | 2026-07-01 |
| Tabletop exercise | Semi-annual | — | 2026-10-01 |

### DR Drill Checklist

- [ ] Backup restoration в staging environment
- [ ] Integrity verification (counts, sums)
- [ ] Application deployment с restored БД
- [ ] End-to-end тестирование (create → sync → read)
- [ ] SLO verification (availability, latency)
- [ ] Documentation update (если шаги изменились)
- [ ] Post-drill review meeting
- [ ] Action items tracking

---

## 8. Post-Incident Process

### Root Cause Analysis (RCA)

1. **Timeline** — что произошло и когда
2. **Impact** — что было затронуто
3. **Root Cause** — почему произошло
4. **Contributing Factors** — что усугубило
5. **Action Items** — как предотвратить

### Action Item Tracking

- Все action items — в GitHub Issues с меткой `incident`
- Due date: 2 недели для P0, 4 недели для P1
- Review на следующем DR drill

---

## 9. Contacts

| Роль | Имя | Контакт |
|------|-----|---------|
| On-call Engineer | Ротация | Telegram |
| Tech Lead | TBD | Email + Phone |
| CTO | TBD | Email + Phone |
| DBA | TBD | Email + Phone |

---

## 10. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-08 | Core Team | Initial version |

---

## 11. Appendices

### A. Backup Locations

```
/backups/pilingtrack/daily/     — Daily backups (7 days)
/backups/pilingtrack/weekly/    — Weekly backups (4 weeks)
/backups/pilingtrack/monthly/   — Monthly backups (12 months)
/backups/pilingtrack/latest.dump — Symlink to latest
```

### B. Important Commands

```bash
# Check backup status
./scripts/backup.sh list

# Restore from specific backup
./scripts/backup.sh restore /backups/pilingtrack/daily/pilingtrack_20260408_020000.dump

# Verify backup integrity
./scripts/backup.sh verify

# Check database health
kubectl exec -it deployment/postgres -- pg_isready

# Check system SLOs
curl -s http://localhost:3000/api/system/slo | jq .
```

### C. Related Documents

- [Runbook: PostgreSQL Down](runbooks/001-postgresql-down.md)
- [Runbook: Data Corruption](runbooks/003-data-corruption.md)
- [Runbook: Outbox Backlog](runbooks/004-outbox-backlog.md)
- [Failure Design Document](FAILURE-DESIGN-DOCUMENT.md)
- [ADR-0002: Outbox vs Kafka](adr/0002-outbox-vs-kafka.md)
