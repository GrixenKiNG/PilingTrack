# ADR-0003: Last-Write-Wins Sync Strategy

| Metadata | Value |
|----------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/core-team |
| **Context** | Offline-first sync conflict resolution |

---

## Context

Операторы сваебойных установок работают в полевых условиях с нестабильным интернетом. Несколько устройств могут редактировать один отчёт одновременно. При синхронизации возникают конфликты версий.

**Варианты разрешения конфликтов:**
1. Last-write-wins (LWW) — серверная версия побеждает
2. Field-level merge — объединение по полям
3. CRDT — автоматическое разрешение через CRDT структуры
4. Manual resolution — UI для ручного выбора

## Decision

**Hybrid strategy:**
1. **Критичные поля** (status, date, siteId, userId) → **Server wins**
2. **Нe-критичные поля** (shiftStart, shiftEnd, equipmentId) → **Client wins**
3. **Коллекции** (piles, drillings, downtimes) → **Merge by ID** (union)
4. **При невозможности merge** → **Conflict detected** → client получает уведомление

### Реализация:
- `src/shared/sync/conflict-resolver.ts` — field-level merge logic
- `src/modules/reports/application/sync-engine-v2.ts` — version tracking
- `src/mobile/sync/sync-batch-response.ts` — partial results с conflicts

## Consequences

### Positive
- ✅ Простота реализации (не CRDT)
- ✅ Нет потери данных для collections (merge by ID)
- ✅ Критичные данные защищены (server wins)
- ✅ Клиент уведомляется о конфликтах

### Negative
- ❌ Возможна потеря изменений в merged fields
- ❌ Нет operational transformation для текстовых полей
- ❌ Ручное разрешение конфликтов не реализовано (только уведомление)

### Risks
- 🟡 При массовом reconnect (100+ операторов) — высокий conflict rate
- 🟡 Нет audit trail для conflict resolution (кто что выбрал)

## Alternatives Considered

1. **CRDT (Automerge/Yjs)**
   - Pros: Автоматическое разрешение всех конфликтов, no data loss
   - Cons: Сложность, overhead памяти, learning curve
   - Why not chosen: Overkill для домена отчётов сваебойки

2. **Operational Transformation (OT)**
   - Pros: Хорош для collaborative editing
   - Cons: Сложность реализации, не подходит для structured data
   - Why not chosen: Наши данные — structured records, не free-form text

3. **Full manual resolution**
   - Pros: Полный контроль над разрешением
   - Cons: UX nightmare для field operators, slows down workflow
   - Why not chosen: Операторам нужна скорость, не precision merge

## Implementation Notes

**Текущее состояние:**
- Field-level merge реализован
- Version tracking через `version` field
- Conflict notification через sync response

**Будущие улучшения:**
- Conflict resolution UI для ручного выбора
- Audit trail для resolved conflicts
- Conflict rate monitoring + alerting

## References

- [src/shared/sync/conflict-resolver.ts](../../src/shared/sync/conflict-resolver.ts)
- [src/modules/reports/application/sync-engine-v2.ts](../../src/modules/reports/application/sync-engine-v2.ts)
- [FAILURE-DESIGN-DOCUMENT.md](../FAILURE-DESIGN-DOCUMENT.md) — F4
