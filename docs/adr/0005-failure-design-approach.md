# ADR-0005: Failure Design Document Approach

| Metadata | Value |
|----------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/core-team |
| **Context** | Системная надёжность через failure-first design |

---

## Context

Большинство систем проектируются через "happy path" — что должно работать. PilingTrack, как offline-first система для работы в полевых условиях, должен проектироваться через "failure path" — что может сломаться и как система на это реагирует.

## Decision

**Failure Design Document (FDD) как обязательный артефакт для каждой новой фичи.**

### Процесс:
1. При проектировании новой фичи → написать FDD секцию
2. Для каждого failure scenario → определить:
   - Симптом (что видит пользователь)
   - Риск (что может пойти не так)
   - Требуемое поведение (как система должна реагировать)
   - Реализацию (какой код это обеспечивает)
   - Guarantee (какой инвариант защищён)
3. Написать тесты для каждого failure scenario
4. Добавить в CI проверку, что все failure scenarios покрыты тестами

### FDD Template:
```markdown
## FXX: [Название сценария]

**Симптом:** [Что видит пользователь/мониторинг]
**Риск:** [Что может пойти не так]
**Требуемое поведение:** [Как система должна реагировать]
**Реализация:** [Файл/код]
**Гарантия:** [Какой инвариант защищён — I1-I5]
**Тест:** [Файл теста]
**Статус:** ✅ / ❌
```

## Consequences

### Positive
- ✅ Систематический подход к надёжности
- ✅ Документированные гарантии, не предположения
- ✅ Тесты для failure scenarios, не только happy path
- ✅ Новые разработчики видят failure model системы

### Negative
- ❌ Дополнительная работа при проектировании фич
- ❌ FDD требует maintenance при изменениях
- ❌ Не все failure scenarios можно протестировать автоматически

### Risks
- 🟡 FDD может устареть если не обновлять при изменениях
- 🟡 Слишком детальный FDD → maintenance overhead

## Alternatives Considered

1. **Chaos Engineering только**
   - Pros: Реальные failure conditions, automated
   - Cons: Не документирует design decisions, hard to debug
   - Why not chosen: Chaos engineering дополнение к FDD, не замена

2. **RFC process только**
   - Pros: Документирует решения
   - Cons: Фокус на happy path, не failure scenarios
   - Why not chosen: FDD специфичен для reliability-focused design

## Implementation Notes

**Текущее состояние:**
- FDD с 15 scenarios реализован
- Каждый scenario имеет файл реализации
- Тесты для key scenarios написаны
- Инварианты I1-I5 определены

**Будущие улучшения:**
- CI check: "все failure scenarios покрыты тестами"
- Dashboard: "FDD compliance %"
- Automated chaos tests для critical scenarios

## References

- [FAILURE-DESIGN-DOCUMENT.md](../FAILURE-DESIGN-DOCUMENT.md)
- [src/core/event-bus/__tests__/failure-design.test.ts](../../src/core/event-bus/__tests__/failure-design.test.ts)
- [TEST-ARCHITECTURE.md](../TEST-ARCHITECTURE.md)
