# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Project-Specific Guidelines (PilingTrack)

### Architecture & Design

**Keep DDD/CQRS boundaries clear:**
- `src/modules/` = domain logic (commands, queries, entities)
- `src/services/` = legacy/shared services (auth, audit, notifications)
- `src/core/` = infrastructure (api-wrapper, observability, circuit-breakers)
- `src/app/api/` = route handlers (use `withApi`/`withMutation` wrappers)

**Simplicity rule:** New code should live in the simplest category possible:
- Try `modules/` first (DDD with clear boundaries)
- Fall back to `services/` only if cross-cutting
- Never add to `core/` unless it's true infrastructure

### API Routes

**Always wrap with `withApi` or `withMutation`:**
- `withApi` — query endpoints (GET), error handling only
- `withMutation` — command endpoints (POST/PUT/DELETE), adds CSRF + rate-limit

**Never duplicate CSRF/rate-limit inline.** The wrapper provides it centrally.

**Validation pattern:**
```typescript
const validated = schema.safeParse(body);
if (!validated.success) {
  return NextResponse.json({ error: 'Validation failed', details: ... }, { status: 400 });
}
const data = validated.data; // use only validated data
```

### Security-Critical Code

**Files that require extra caution** (test-first, careful code review):
- `src/services/auth/` — authentication, session, token logic
- `src/services/auth/authorization-service.ts` — permission checks
- `src/core/security/` — encryption, token rotation, CSRF
- `src/lib/rate-limiter.ts` — rate limiting logic

**When touching these:** Write a test that reproduces the behavior, then change it. Never refactor "cleanly" without tests.

### Testing

**Test-first for security bugs:**
- Timing attacks on password/PIN comparison → use `crypto.timingSafeEqual`
- Session/token leaks → test token rotation + revocation
- Rate limit bypasses → test limits at boundary conditions

**Unit tests are in `src/**/__tests__/`; integration tests are limited.**
You can write unit tests. Flag if you need integration test infrastructure.

### Common Pitfalls to Avoid

| Pitfall | Fix |
|---------|-----|
| Inline try/catch in routes when withApi/withMutation exist | Use the wrapper |
| Duplicating CSRF/rate-limit checks | Remove from route handler |
| Large files (>500 lines) | Split by concern (e.g., service + controller) |
| `as any` in security-critical code | Use proper types, especially in auth/ |
| `console.log` in production services | Use `logger.*` from `src/lib/logger` |
| Speculative abstractions (strategy pattern for one use case) | Write the simple version first |

### Performance Considerations

**Respect existing patterns:**
- `src/lib/cache-strategies.ts` for caching decisions
- `src/lib/db-optimization.ts` for DB query patterns (`$queryRaw` over `$queryRawUnsafe`)
- Redis is used for cache + rate limiting, not database replacement

**Don't optimize prematurely.** Profile if slow, then fix.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **PilingTrack** (10535 symbols, 17954 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/PilingTrack/context` | Codebase overview, check index freshness |
| `gitnexus://repo/PilingTrack/clusters` | All functional areas |
| `gitnexus://repo/PilingTrack/processes` | All execution flows |
| `gitnexus://repo/PilingTrack/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
