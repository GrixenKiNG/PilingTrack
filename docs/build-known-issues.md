# Build Known Issues

## Turbopack + Prisma generated Postgres client

### Симптом

При `npm run build` может появляться warning:

- `Encountered unexpected file in NFT list`
- import trace идёт через:
  - `src/generated/postgres-client/runtime/library.js`
  - `src/generated/postgres-client/index.js`
  - `src/lib/db.ts`
  - `src/app/api/reports/single-pdf/route.ts`

### Текущий статус

- Warning неблокирующий.
- `build`, `typecheck` и standalone runtime проходят успешно.
- Основной риск связан с тем, что Prisma generated runtime использует слишком широкие file traces для Turbopack/NFT.

### Что уже сделано

- Postgres client подключается лениво в `src/lib/db.ts`.
- После `prisma generate` применяется patch через `scripts/patch-postgres-client.js`.
- Standalone сборка продолжает работать.

### Почему пока не выпилили warning полностью

Проблема сидит не в route handler напрямую, а в generated Prisma runtime, который Turbopack продолжает трассировать шире, чем нужно. Полное устранение warning, скорее всего, потребует одного из следующих шагов:

1. Вынести Postgres client из `src/generated/*` в отдельный runtime adapter/package.
2. Отделить Postgres-only server code от общего app import graph.
3. Дождаться более дружелюбного поведения Turbopack/Prisma на этом паттерне.

### Правило на текущем этапе

Этот warning считаем известным техническим хвостом, но не blocker'ом, пока:

- `npm run lint` проходит
- `npm run typecheck` проходит
- `npm run test:smoke:auth-access` проходит
- standalone runtime работает
