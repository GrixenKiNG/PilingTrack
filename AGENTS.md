# AGENTS.md — PilingTrack

Instructions for coding agents other than Claude (Codex and similar). Claude reads `CLAUDE.md`; this file carries the same rules for you.

**Who you are here.** You are a contractor. Your work is reviewed by Claude and accepted or rejected by the owner. The owner is not a programmer and speaks Russian — write your final report in Russian. The reviewer re-runs every check you claim, so an honest "failed / not checked" is worth more than a green claim that doesn't reproduce.

## 1. Hard limits (never, unless the task text explicitly says otherwise)

- **Branch only.** Work in a new branch `codex/<short-task-name>`. Never commit to `main`, never push, never merge, never rewrite history.
- **No production.** Never deploy, never SSH to the server, never connect to the production database, never run `scripts/deploy-prod.sh`. Deploys happen only on the owner's explicit command, done by someone else.
- **No database schema work.** Don't edit `prisma/schema.prisma` or `prisma/migrations/**`. Never run `prisma migrate dev`, `prisma migrate reset` or `prisma db push` — they can wipe the local database. `npm run db:generate` is fine.
- **No secrets.** Don't read, create or edit `.env*` files; don't invent env values to make a build pass. If a check fails for lack of env/DB, report that.
- **Security-critical files are off-limits:** `src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts`, `src/services/auth/authorization-service.ts`, anything RLS/tenancy-related, `docker-compose*`, `Dockerfile*`, `scripts/deploy-*`.
- **No new dependencies** and no version bumps unless that is the task.
- **Frozen areas — don't edit, refactor or delete, even if they look duplicated or dead.** The owner is still choosing between these variants and will clean them up personally:
  - all operator screen variants: `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`;
  - the ORION public site and its concepts: `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`, `public/orion*`.
  If a task seems to require touching them, stop and say so in the report.

## 2. How to change code

- **Minimum code that solves the task.** No features beyond the request, no abstractions for one use, no "flexibility" nobody asked for. If 200 lines could be 50, write 50.
- **Surgical.** Every changed line must trace to the task. Don't reformat, rename or "improve" neighbouring code. Match existing style. Mention unrelated problems in the report instead of fixing them.
- **Clean up only your own mess:** remove imports/variables your change made unused; leave pre-existing dead code alone unless the task is removing it.
- **Unclear? Stop and say so** in the report instead of guessing. List assumptions explicitly.
- Files over ~500 lines: split by concern only if the task asks.

## 3. Project architecture (short)

- `src/modules/` — domain logic (commands, queries, entities). `reports/` is the fully migrated reference layout.
- `src/services/` — legacy/shared services. `users`, `analytics`, `telemetry`, `system` still live here behind `modules/<x>/index.ts` facades. **Don't start a services→modules migration.** Import through `@/modules/<x>`.
- `src/core/` — infrastructure only. `src/app/api/` — route handlers.
- API routes: wrap GET with `withApi`, POST/PUT/DELETE with `withMutation` (it provides CSRF + rate limit — never duplicate them inline). Validate with `schema.safeParse(body)`; on failure return 400; use only `validated.data`.
- **Tenancy fails closed:** a missing `tenantId` throws; use strict equality. Never write `tenantId IS NULL OR ...` — it returns every tenant's rows.
- Raw SQL: `$queryRaw` with template parameters, never `$queryRawUnsafe`; see `src/core/infrastructure/raw-queries.ts`.
- Logging: `logger.*` from `src/lib/logger`, not `console.log`. No `as any` in auth/security code.
- **Trust model (owner decision 2026-07-12, don't re-raise as a bug):** `ADMIN` and `DISPATCHER` are *platform* roles and see every tenant by design — there is no "tenant admin" today. `FOREMAN` (Мастер) and `SAFETY_ENGINEER` (Инженер ОТ) have no users; an admin acts as them. Cross-tenant findings matter for `OPERATOR`/`ASSISTANT` and any path reachable without a privileged role. Production is single-tenant (`orion`); report cross-tenant issues as "before tenant #2" unless they also leak inside one tenant.
- Domain words (свая, куст, пикет, простой, ЕО/ТО, наряд…) map to code names in `.claude/skills/domain-glossary/SKILL.md`. Change rules and their history: `.claude/skills/pilingtrack-change-control/SKILL.md`.

## 4. Deleting code — prove it first

Deleting "unused" things has destroyed real data here before. For every file/export you remove:

1. Search the **whole repo** — `src/`, `e2e/`, `tests/`, `scripts/`, `prisma/`, config files — for imports, dynamic imports, route paths as strings and CSS class usage.
2. GitNexus `impact` returning zero callers or `risk: UNKNOWN` does **not** prove it's unused; confirm with text search.
3. Removing a component or function → remove its unit tests and Playwright e2e specs too. One broken import makes Playwright collect **zero** tests while still looking fine.
4. List every removed path in the report with the evidence that nothing live used it.

**Looks dead, but must stay:**
- `src/components/piling/operator-dashboard.tsx` and `src/components/piling/operator/**` — the documented rollback path for the operator screen.
- Roles «Мастер» and «Инженер ОТ» — no users by design (an admin acts as them).
- Telemetry code — dormant until hardware is connected, not dead.
- Multi-tenancy code — kept on purpose for future tenants.
- The `@custom-variant dark` line in `src/app/globals.css`.
- Inline `eslint-disable` comments — each is intentional (lint baseline is zero warnings).

## 5. Tests

- The owner wants a lean test suite: **no new test files** unless the task requires one or it guards a destructive/auth operation. Unit tests live next to code as `*.test.ts(x)` or in `__tests__/`.
- Vitest does not load `.env`; integration specs may silently skip. Report the passed/skipped counts, not just "green".

## 6. Verification before you report

Run each command separately and record its **real exit code** — never pipe through `| tail`/`| head` (that hides failure).

```bash
rm -rf .next/dev/types          # stale generated types give false "clean" tsc
npx tsc --noEmit
npm run lint
npm run test:unit
npx playwright test --list      # the test count must not drop unexpectedly
npm run build                   # needs env; if it fails on env/DB, say so — don't fake env
```

`tsc` alone is not enough — Next route types are only checked by `npm run build`.

Environment notes: Windows + Git Bash. Python is not installed — use `node` for scripts. A fresh worktree has no `src/generated`; run `npm run db:generate` first.

## 7. Final report (in Russian)

1. What was done — one commit per logical change, with commit hashes.
2. Removed/changed files with line counts; for deletions, the evidence they were unused.
3. What you deliberately left alone and why.
4. Each check from §6: command, exit code, key numbers (tests passed/skipped, Playwright count).
5. Open questions and risks you're not sure about.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **PilingTrack** (23154 symbols, 45336 relationships, 1131 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/PilingTrack/context` | Codebase overview, check index freshness |
| `gitnexus://repo/PilingTrack/clusters` | All functional areas |
| `gitnexus://repo/PilingTrack/processes` | All execution flows |
| `gitnexus://repo/PilingTrack/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
