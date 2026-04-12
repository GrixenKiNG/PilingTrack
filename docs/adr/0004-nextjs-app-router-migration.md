# ADR-0004: Next.js App Router — SPA vs File-based Routing

| Metadata | Value |
|----------|-------|
| **Status** | Superseded by ADR-0005 |
| **Date** | 2026-04-08 |
| **Authors** | Core Team |
| **Reviewers** | @pilingtrack/frontend-team |
| **Context** | Client-side routing vs Next.js App Router |

---

## Context

PilingTrack использует SPA-подобный роутинг через Zustand store в `src/app/page.tsx`. Это отключает преимущества Next.js App Router:
- Нет Server Components
- Нет SSR для страниц
- Весь JS bundle загружается клиентом
- Нет code splitting по route

## Decision

**Миграция на файловый роутинг Next.js App Router.**

Каждый экран → отдельный route:
- `/operator` — операторский дашборд
- `/admin` — админский дашборд
- `/admin/sites` — управление объектами
- `/admin/reports` — управление отчётами
- `/report/new` — создание отчёта

### Что остаётся в Zustand:
- `currentUser` — сессия
- `selectedSiteId` — выбранный объект
- `localFeedbackEvents` — временные уведомления

### Что переезжает в App Router:
- `currentPage` — навигация
- `navigate()` — `useRouter().push()`

## Consequences

### Positive
- ✅ Server Components для data loading
- ✅ Automatic code splitting по route
- ✅ SSR для SEO и initial load
- ✅ Next.js caching для API routes

### Negative
- ❌ Усложнение структуры (больше файлов)
- ❌ Необходимость migration для существующих компонентов
- ❌ Auth flow должен работать на сервере

### Risks
- 🟡 При миграции можно сломать offline-first поведение
- 🟡 Server Components не работают offline

## Alternatives Considered

1. **Оставить SPA + добавить SSR**
   - Pros: Минимальные изменения
   - Cons: Не решает code splitting, сложность SSR для SPA
   - Why not chosen: Не используем преимущества Next.js

2. **Полный переход на SPA (вынести Next.js)**
   - Pros: Проще архитектура, полный контроль
   - Cons: Потеряем SSR, API routes, встроенный routing
   - Why not chosen: Next.js API routes удобны для BFF pattern

## Implementation Notes

Миграция проведена постепенно, экран за экраном:
1. Создать `(app)/layout.tsx` с общим layout
2. Перенести каждый экран в отдельный `page.tsx`
3. Заменить `navigate()` на `useRouter().push()`
4. Удалить старый SPA роутинг

## References

- [src/app/(app)/](../../src/app/(app)/)
- [src/app/(auth)/](../../src/app/(auth)/)
- [src/app/page.tsx](../../src/app/page.tsx)
