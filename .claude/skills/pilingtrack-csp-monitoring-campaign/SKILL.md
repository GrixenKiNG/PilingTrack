---
name: pilingtrack-csp-monitoring-campaign
description: >-
  Use when a Content-Security-Policy violation blocks a script chunk on
  /monitoring, the browser console shows "Refused to execute script" or
  "Refused to load the script" on that page, someone asks about
  strict-dynamic / nonce CSP breaking a Next.js chunk, or a fix to
  src/proxy.ts's CSP is being proposed for a monitoring-page bug. Owns
  this specific open CSP investigation end-to-end; does not cover
  CSP-unrelated /monitoring bugs.
---

# PilingTrack CSP / Monitoring Campaign

**Status as of 2026-07-09: OPEN — ROOT-CAUSED, no clean in-place fix yet.**
Reproduced end-to-end locally and the injection point is localized (Phase 2
complete). No fix shipped — the fix is now a build-pipeline *decision*, see
below. This file is the campaign's working memory — read it top to bottom
before you touch anything, and update it (or the closure note at the bottom)
when you learn something that changes the picture.

### 2026-07-09 investigation — confirmed findings (verified locally)

- **Reproduced** with `npm run build && npm start` (standalone prod server,
  `NODE_ENV=production`). On `/monitoring` the console shows exactly the
  campaign's expected error for chunk `0c_v1-l3b~-oa.js`. It fires **before
  auth** (page bounces to `/login` on 401, error still fires).
- **Root cause localized (Experiment 1):** the served HTML has **35 `<script>`
  tags; 34 carry the nonce, exactly 1 does not.** The nonce-less one is
  `<script src="/_next/static/chunks/<hash>.js" async>` with **no `nonce`
  attribute**. The CSP response header itself is correct (fresh nonce +
  strict-dynamic). So this is a *nonce-stamping gap on one specific SSR script
  tag*, not a policy-string bug — **do not touch `buildNonceCsp`.**
- **What the rogue chunk is:** the **lucide-react base chunk** (1324 bytes:
  `createLucideIcon`/`mergeClasses`/`forwardRef`, `globalThis.TURBOPACK.push`).
  Turbopack auto-barrel-optimizes `lucide-react` into this separate bootstrap
  chunk; its `<script>` tag is emitted without the nonce (suspected React
  Float `preinit` path that doesn't thread the nonce — a Next+Turbopack
  framework bug, cf. vercel/next.js#89754-adjacent).
- **NOT `/monitoring`-specific.** The same nonce-less chunk appears on
  `/login`, `/operator`, `/report`, `/history`, `/inspections` too. The
  "/monitoring" framing was just where it was first noticed. The Sentry
  `tunnelRoute:"/monitoring"` lead (Experiment 4) is a **dead end** for this
  bug — refuted.
- **Bundler confirmed = Turbopack** (build banner `Next.js 16.2.6
  (Turbopack)`). Resolves Experiment 5's open question; the `~` in chunk names
  is Turbopack naming, not webpack split-chunks.

### Fixes RULED OUT on 2026-07-09 (don't repeat these)

| Attempt | Result |
|---|---|
| Upgrade Next `16.2.6 → 16.2.10` (keep Turbopack) | **Does not fix** — verified: still 34/35 nonced, same lucide chunk nonce-less (renamed `141azqsq5pyeo.js`). Reverted. |
| `next build --webpack` (webpack threads nonce correctly) | **Build fails type-check** on this repo/version — generated route validator error `checkFields<Diff<{GET?:Function;HEAD?:Function;OPTIONS?:Function}>>`. Would need that error fixed first, and is a full bundler switch. |
| `experimental.optimizePackageImports` to drop lucide opt | **No-op under Turbopack** — Next docs: "not needed when using Turbopack; Turbopack automatically analyzes and optimizes imports." Turbopack ignores the option. |
| Weaken CSP (`'unsafe-inline'`/`'self'`/drop strict-dynamic) | Fenced off — forbidden (see Fenced-off wrong paths). |
| Hash (`'sha256-'`) the chunk | Fenced off — chunk name+content change every build. |

### Remaining viable paths (a DECISION, not a blind patch — route via `pilingtrack-change-control`)

1. **Switch prod build to webpack** — most likely real fix (mature nonce
   threading; also unlocks SRI). Prerequisite: resolve the route-validator
   type error above. Cost: abandons the deliberate Turbopack build; slower
   builds. Needs owner sign-off (build-pipeline change class).
2. **`Content-Security-Policy-Report-Only` shadow + track upstream** (Phase 3
   #4) — doesn't fix for users; gathers evidence while waiting for a
   Next/Turbopack fix. Low risk.
3. **Wait for an upstream Turbopack/React-Float nonce fix** and re-test each
   Next patch (`grep '"next"' package.json` for current version; retest the
   Experiment-1 nonce count).

**Impact — ASSESSED 2026-07-09: cosmetic / low urgency.** Verified in a local
standalone build with Playwright across `/login`, `/admin`, `/monitoring`:
the page renders fully (53 lucide icons on `/monitoring`), React **hydrates
successfully** (`__reactFiber` present, 23 live buttons/3 selects), and there
is **exactly one console error per load** (the CSP block) with **no** React
"element type is invalid", hydration, or chunk-load errors. Icons show because
they are SSR'd into the HTML and hydration succeeds regardless of the blocked
chunk. So the symptom is **console/Sentry noise + a defense-in-depth gap** (a
script escaping nonce control), NOT user-facing breakage. Prioritize
accordingly — the safe interim (Report-Only, or simply wait for an upstream
Turbopack/React-Float nonce fix and retest each Next release) is reasonable;
the webpack bundler switch is the only real fix but is a larger, sign-off-level
change for a cosmetic symptom.

**Prime directive: do not patch `src/proxy.ts` blind, and do not weaken the
CSP to make the symptom go away.** The nonce + `strict-dynamic` policy is a
deliberate, already-hardened design (audit item C-4, `150caa3`) that has
already survived one production incident (`14cc527`, the white-screen bug —
see Phase 0). A theory must be *proved*, not just plausible, before you touch
`buildNonceCsp`. Read §"Fenced-off wrong paths" before you write any patch.

**Jump table — read linearly the first time; use this to resume mid-investigation.**

| Phase | What it covers | You may start here only if... |
|---|---|---|
| 0 — Theory | CSP primer, prior incident, ruled-out causes | you have no theory yet |
| 1 — Reproduce | Get the violation to happen locally, on demand | Phase 0 is already understood/ruled-out |
| 2 — Localize | Find the exact nonce-drop injection point | you have a **reliable local repro** from Phase 1 |
| 3 — Solution menu | Ranked fix candidates, each with a theory obligation | you have a **localized, proved** root cause from Phase 2 |
| 4 — Validate & promote | Verify → `qa-checklist` → deploy → operator prod check → close | you've applied a Phase-3 fix — mandatory, not optional |

## When NOT to use

- **A /monitoring bug that isn't a CSP violation** (wrong numbers, missing
  data, wrong permissions) → `pilingtrack-debugging-playbook` row #5 and #8
  cover the fleet-card projection-lag bug and point CSP issues back here —
  don't conflate the two.
- **You already know the general triage table entry** → row #8 of
  `pilingtrack-debugging-playbook` is the one-line pointer to this file; you're
  already in the right place.
- **You want the general debugging method** (not project-specific) →
  `superpowers:systematic-debugging`. This file assumes that method and adds
  the CSP-specific theory and experiments on top of it.
- **You're about to touch `src/services/auth/**`, `src/core/security/**`, or
  any other security-critical file for an unrelated reason** →
  `pilingtrack-change-control` and CLAUDE.md's security-critical rules apply,
  not this file.
- **You're proposing a *new* CSP feature (e.g. adding a new external
  script source) unrelated to this bug** → that's a scope decision for
  `pilingtrack-change-control`, not a CSP-monitoring-campaign fix.

**Before doing anything else: check `pilingtrack-failure-archaeology` for a
closure note on this campaign.** If it says CLOSED with a commit hash, this
file is stale — verify the commit landed, update the status banner above, and
stop following the phases below.

---

## Phase 0 — Theory (read this before touching anything)

You cannot debug this correctly without the exact semantics of
`strict-dynamic`. Get them wrong and you'll "fix" it by weakening the policy,
which is the one outcome the owner has explicitly forbidden.

### Terms, defined precisely

- **CSP (Content-Security-Policy)** — an HTTP response header (or
  `<meta>` tag) that tells the browser which sources are allowed to execute
  as script, load as style, connect as fetch/XHR, etc. Each resource type has
  its own directive (`script-src`, `style-src`, `connect-src`, ...). If a
  directive is violated, the browser refuses the action and (in most
  browsers) logs `Refused to execute script from '<url>' because it violates
  the following Content Security Policy directive: "..."` to the console.
- **Nonce** — a random, per-response, single-use token. The server puts it
  both in the CSP header (`script-src 'nonce-abc123'`) and as a `nonce="abc123"`
  attribute on the `<script>` tags it renders. The browser only allow-lists a
  `<script>` tag whose `nonce` attribute matches the one in the header for
  *that specific response*. A nonce from a previous response, or no nonce at
  all, does not authorize the script.
- **`strict-dynamic`** — a `script-src` keyword with one very specific,
  easy-to-misread effect: **when present, the browser IGNORES every other
  source expression in that directive** — `'self'`, `https:`, explicit
  hostnames, everything — for classifying *newly-inserted* scripts. The only
  things that still authorize a script are (a) a matching nonce, or (b) a
  matching hash (`'sha256-...'`), or (c) being loaded **by** a script that was
  itself already authorized by nonce/hash (see "propagation" below).
  `strict-dynamic` is what lets a nonce-based policy tolerate the fact that a
  modern JS bundle dynamically inserts dozens of chunk `<script>` tags at
  runtime (code-splitting) without hand-nonce-ing every one — but it is also
  why "just add `'self'`" NEVER helps once `strict-dynamic` is present. Read
  that sentence twice; it is the single most common wrong turn in this
  investigation (see Fenced-off paths below).
- **Nonce propagation ("trust chain")** — under `strict-dynamic`, a script
  tag that is inserted into the DOM *by* an already-trusted script (e.g. a
  bundler runtime doing `document.createElement('script'); script.src = ...;
  document.head.appendChild(script)`) is automatically trusted too, with NO
  nonce needed on the child tag. This is how Next.js code-splitting normally
  survives `strict-dynamic`: the initially-nonce'd bootstrap script is
  trusted, and it dynamically injects every subsequent chunk, so the whole
  chain inherits trust. **The chain breaks** if a script reaches the page
  through a path that isn't "inserted by an already-trusted script" — e.g.:
  - A `<script src=...>` tag written directly into the initial HTML by
    something other than the nonce-aware renderer (no nonce attribute, not
    inserted by trusted JS either) → blocked outright.
  - A `<link rel="modulepreload">` or `<link rel="preload" as="script">` —
    preloading does not execute the script, but if something later inserts a
    `<script>` for that preloaded URL *without* going through the trusted
    JS-insertion path, it's still just an untrusted new script tag.
  - An inline bootstrap `<script>` (no `src`) rendered without a `nonce`
    attribute — happens when a React tree renders `<script>` via
    `dangerouslySetInnerHTML` or a lib that doesn't accept a `nonce` prop.
  - A response that never went through the nonce-minting code path at all
    (prerendered/cached HTML — see the `14cc527` incident below) — its
    `<script>` tags have no nonce attribute to match *any* header, cached or
    fresh.
- **Why `'self'` is a no-op here** — `'self'` means "same origin as the
  document". It is a static allow-list entry. `strict-dynamic` explicitly
  tells the browser: ignore static allow-list entries for script
  classification. Adding `'self'`, `https://orionpiling.ru`, or any other
  static source to `script-src` while `strict-dynamic` is present changes
  nothing observable — browsers that understand `strict-dynamic` (all
  evergreen browsers) skip straight past it.

### Ground truth: read `src/proxy.ts` yourself, don't trust paraphrase

The whole policy lives in `buildNonceCsp()`, `src/proxy.ts:144-182`, called
from `proxy()` at `src/proxy.ts:229`. Quoted verbatim (2026-07-08):

```ts
function buildNonceCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';

  return [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    isDev
      ? "img-src 'self' data: blob: https: http://localhost:*"
      : "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    isDev
      ? "connect-src 'self' https: ws: wss: http://localhost:*"
      : "connect-src 'self' https: ws: wss:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' blob:",
  ].join('; ');
}
```

Key facts this proves, each independently checkable against the file:

1. **Prod/test `script-src`** is exactly
   `script-src 'self' 'nonce-<X>' 'strict-dynamic' 'wasm-unsafe-eval'`. The
   `'self'` token is present in source but — per Phase 0 theory — inert for
   script authorization once `'strict-dynamic'` is also present. It is not
   dead code to "clean up"; leaving it costs nothing and some older tooling
   or non-`strict-dynamic`-aware crawlers may still read it.
2. **`isDev` is keyed off exactly `NODE_ENV === 'development'`** — not
   `!== 'production'`. The comment at `src/proxy.ts:145-148` says this
   precisely to keep `NODE_ENV=test` (used by `vitest`) on the *hardened*
   branch, so `src/__tests__/proxy-csp.test.ts` exercises the real prod
   policy, not a relaxed one. **This means your local `npm start` run is on
   the SAME branch as prod** (`NODE_ENV=production` from the standalone
   server) — good, this bug is reproducible without deploying.
3. **Dev deliberately drops both `strict-dynamic` and the nonce**, per the
   comment at lines 156-161: `next dev`'s HMR/React-Refresh runtime "loads
   some chunks (incl. the app/loading.tsx + not-found boundary) without a
   nonce", and without `strict-dynamic` neutering `'self'`, those same-origin
   chunks are authorized again by the plain allow-list. **This is a documented
   historical near-miss of the exact bug class you're chasing** — dev already
   had chunks that don't inherit nonce trust; the dev fix was "don't use
   strict-dynamic in dev", which is not an option for prod. Take this comment
   as a hint about *where* untrusted chunks come from architecturally
   (loading/not-found boundaries), even though dev itself isn't broken.
4. `proxy()` (`src/proxy.ts:188-240`) only builds this policy in the "HTML
   branch" (non-`/api` paths, `src/proxy.ts:226-239`). It mints a fresh
   `nonce = btoa(crypto.randomUUID())` per request, stamps it onto the
   **request** headers as `x-nonce` (so `next/headers` can read it inside
   Server Components — see `src/app/layout.tsx:85`), and sets the same policy
   string on the **response** as `Content-Security-Policy`.
5. `proxy-csp.test.ts` (`src/__tests__/proxy-csp.test.ts`) already encodes
   most of the above as executable assertions. **If you're forming a theory
   about the policy string itself, write a failing test in this file first**
   — it's the fastest way to prove a policy-construction bug in isolation
   from the browser/build pipeline.

### The `14cc527` precedent — read it before forming any theory

Commit `14cc527` ("fix(csp,pwa): force-dynamic rendering so proxy nonce
reaches every page", 2026-05-14) fixed a **structurally identical bug**: pages
were prerendered at *build* time (no request, no proxy, no nonce), so their
`<script>` tags had no `nonce` attribute; at *runtime* the proxy still emitted
the strict nonce+`strict-dynamic` policy, and the browser correctly refused
every nonce-less tag — a total white-screen. The fix was
`export const dynamic = 'force-dynamic'` in `src/app/layout.tsx:16`, forcing
every HTML route (including `/monitoring`, which is a normal child route) to
render per-request so the proxy's nonce is live when the tags are stamped.

This precedent matters for two reasons:
- It confirms the **general failure shape** you're likely looking at again:
  *some* script tag related to `/monitoring` is reaching the browser without
  having gone through the request-time nonce-stamping path.
- It confirms `force-dynamic` is *already applied globally* — so "the page
  isn't dynamic" is NOT your answer this time (verified: `grep -rn
  "force-dynamic" src/app` → only hit is `src/app/layout.tsx:16`, and it's
  the *root* layout, which every route including `(app)/monitoring` inherits
  from; there is no competing `export const dynamic = 'force-static'`
  anywhere under `src/app/(app)/monitoring/`). Something *else* is not
  inheriting nonce trust this time — see Phase 2 for concrete candidates.

Also read `git show 150caa3` (the original C-4 CSP commit) if you want full
history; `14cc527` is the more relevant one for a script-loading bug.

---

## Phase 1 — Reproduce locally

**Goal: see the exact console error on your machine before touching code.**
Dev (`npm run dev`) will NOT reproduce this — dev's CSP branch has no
`strict-dynamic` at all (Phase 0, point 3). You need the **standalone
production build**, same as what runs in the `pilingtrack-app` container.

### Prerequisites (verify once)

- `.env` must satisfy `scripts/validate-env.ts` — `DATABASE_PROVIDER`,
  `SESSION_SECRET` (≥32 chars, not the placeholder), and Postgres vars if
  `DATABASE_PROVIDER=postgres`. If you don't already have a working local
  `.env`, use the `pilingtrack-build-and-env` skill first — don't hand-roll one.
- Local Postgres/Redis running (Docker), per that same skill.
- `npm run build` here means the real `package.json` script:
  `npx tsx scripts/validate-env.ts && npm run db:generate && next build &&
  node scripts/copy-standalone-assets.js` (verified in `package.json`,
  2026-07-08) — it validates env, generates the Prisma client, runs `next
  build`, then copies static/public assets into `.next/standalone` (the
  standalone server does not serve `public/`/`.next/static` on its own
  without this step).
- `npm start` means `npx tsx scripts/validate-env.ts && node
  .next/standalone/server.js` — this is the exact binary the prod Dockerfile
  runs. `next start` (the ordinary dev-adjacent command) is NOT used here and
  would skip the standalone-specific asset wiring; don't substitute it.

### Steps

```bash
npm run build
npm start
```

Then in a browser (not `curl` — you need to see console errors and the
Network tab):

1. Open `http://localhost:3000/monitoring`, hard-reload
   (Ctrl+Shift+R / Cmd+Shift+R to bypass any HTTP cache).
2. Open DevTools → Console.

**Expected observation if it reproduces:** a red console error of the shape

```
Refused to execute script from 'http://localhost:3000/_next/static/chunks/<name>.js'
because it violates the following Content Security Policy directive:
"script-src 'self' 'nonce-...' 'strict-dynamic' 'wasm-unsafe-eval'".
```

naming a specific chunk (prod example seen: `0c_v1-l3b~-oa.js`) and the
`script-src` directive. Confirm in DevTools → Network that the chunk request
itself may still show `200` (CSP blocks *execution*, not always the fetch) —
don't be misled by a green network row into thinking nothing failed.

### GATE

- **Reproduces** (you see the error above) → go to **Phase 2**. You have a
  local, fast, git-bumpable repro — use it for every experiment from here on,
  don't test against prod.
- **Does NOT reproduce locally** → do not conclude "fixed" or "can't happen".
  Branch into isolating prod-only differences, testing ONE at a time (each
  with a command that gives a yes/no answer):

  | Prod-only difference | Discriminating check | If it flips the result |
  |---|---|---|
  | **Caddy** (reverse proxy, `deploy/Caddyfile.prod`) — could it be adding/stripping/duplicating a CSP header, or serving cached bytes? | `curl -sI https://orionpiling.ru/monitoring \| grep -i content-security-policy` vs the same on your local `curl -sI http://localhost:3000/monitoring` — diff the two strings directive-by-directive | Caddy is rewriting the header → read `deploy/Caddyfile.prod`, don't touch `src/proxy.ts` |
  | **`NODE_ENV`** — is prod really `production`? | `docker compose exec app env \| grep NODE_ENV` on the VPS | If not `production`, you're on a different `buildNonceCsp` branch than you think — theory needs to change |
  | **PWA / service worker caching stale HTML with a stale nonce** | **Already ruled out at the code level** (see box below) — do not spend time on this branch unless the code has changed since 2026-07-08 | — |
  | **Sentry `tunnelRoute` collision** — see Phase 2, this is prod-relevant regardless of local repro and worth checking either way | See Phase 2 experiment 4 | If confirmed, it's a routing question, not a CSP-string question |
  | **Cached HTML at Caddy or CDN layer serving a stale nonce inside otherwise-fresh CSP header** | `curl -s https://orionpiling.ru/monitoring \| grep -o 'nonce-[A-Za-z0-9+/=]*' \| sort -u` — run it 3× a few seconds apart; the embedded `nonce-...` value in the HTML `<script>` tags must be DIFFERENT each time and must match the `nonce-...` in that same response's CSP header | If the nonce value in the HTML is stuck (repeats across requests) or doesn't match the header's nonce → cached HTML, go to Solution Menu #2 |

  > **PWA/service-worker theory — already refuted, verified 2026-07-08.**
  > `next.config.ts:90-93` states explicitly: *"PWA cache headers (/sw.js,
  > /manifest.json, /icon-:size.svg) removed 2026-05-24 — the PWA was
  > retired (no service worker, no manifest)."* Confirmed independently:
  > no `public/sw.js`, no `public/manifest.json`, and a repo-wide grep for
  > `serviceWorker|workbox|next-pwa` across `src/`, `public/`, and config
  > files returns nothing relevant. **Do not spend time re-investigating a
  > service worker; there isn't one.** If this changes (PWA reintroduced),
  > strike this note and re-open the branch.

---

## Phase 2 — Localize the nonce-drop path

Once you have a local repro, find out **exactly which script tag or fetch
breaks the trust chain**, and **how it got there**. Each experiment below has
an expected output and a next step — don't skip to a fix before you've run at
least experiment 1.

### Experiment 1 — read the actual served HTML for nonce presence

```bash
curl -s http://localhost:3000/monitoring -o /tmp/monitoring.html
grep -o '<script[^>]*>' /tmp/monitoring.html
```

- **Expected if healthy:** every `<script src=...>` and every inline
  `<script>` tag carries a `nonce="..."` attribute, and it's the same value
  across all of them (one nonce per response).
- **If you find a `<script>` tag with NO `nonce` attribute** → that's an
  inline-bootstrap-without-nonce bug (Solution Menu #1/#3 territory). Check
  which component rendered it — `grep -rn "dangerouslySetInnerHTML.*script\|<script" src/app` is
  the starting point; `src/app/layout.tsx:91` (`DEV_PERFORMANCE_MEASURE_GUARD`)
  is dev-only (`process.env.NODE_ENV === 'development'` guard at line 90) so
  it should NOT appear in a `npm start` (production) response — verify it doesn't.
- **If every `<script>` tag DOES carry a matching nonce** → the failing chunk
  is not in the initial HTML at all; it's being inserted *later*, by client
  JS. Go to Experiment 2.

### Experiment 2 — is the blocked chunk inserted by trusted JS, or by something else?

In DevTools, reproduce the violation (Phase 1), then:

1. Click the failing "Refused to execute script" console entry to expand the
   stack trace / initiator.
2. Network tab → find the request for the named chunk (e.g.
   `0c_v1-l3b~-oa.js`) → check the **Initiator** column/tab.

- **Initiator is a Next.js runtime chunk** (something like `webpack.js`,
  `main-*.js`, or a Turbopack-equivalent runtime file) **and** that same
  runtime chunk itself carries a nonce in the initial HTML → this SHOULD
  inherit trust per `strict-dynamic` propagation (Phase 0). If it's still
  blocked, either (a) the chunk is reached via a `<link rel="modulepreload">`
  that a *different*, untrusted piece of code turns into a `<script>` tag, or
  (b) something browser-specific is not honoring propagation as expected —
  worth a minimal-repro test in an isolated HTML file with the exact same CSP
  header before assuming a Next.js bug.
- **Initiator is `(index)`** (i.e., a `<link rel="preload"/"modulepreload">`
  in the HTML `<head>` itself, not JS) → check Experiment 1's HTML dump for
  `<link rel="modulepreload" href=".../0c_v1-l3b~-oa.js">` or similar. A
  preload/modulepreload link has no `nonce` concept of its own — the browser
  fetches it speculatively regardless of CSP `script-src` (preload uses
  different directives), but if the *execution* is later triggered by code
  that isn't part of the trusted chain, THAT'S your break point, not the
  preload tag itself. Confirm by checking whether the executing `<script>`
  eventually created for that URL has a `nonce` or is chain-inserted.
- **Initiator is the `loading.tsx` / route-boundary machinery** → Phase 0's
  dev-CSP comment (`src/proxy.ts:158-160`) explicitly flagged
  "`app/loading.tsx` + not-found boundary" chunks as historically
  nonce-less in dev. `/monitoring` has no local `loading.tsx` (only
  `src/app/loading.tsx` at the root applies, confirmed:
  `find "src/app/(app)/monitoring" -iname "loading.tsx"` → no match), so if
  the root loading boundary's chunk is what's failing, that's a strong,
  concrete lead — check whether the root `Loading` component
  (`src/app/loading.tsx`) or its chunk shows up in the initiator chain.

### Experiment 3 — did this request go through `proxy()` at all?

`force-dynamic` only helps if the request actually executes `proxy()` and
gets a matching nonce echoed onto both the HTML and the header. Check the
matcher (`src/proxy.ts:245-255`):

```ts
export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon-).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
```

- `/monitoring` itself is not excluded by the `source` pattern (only
  `_next/static`, `_next/image`, `favicon.ico`, `icon-*` are) — the initial
  page navigation WILL go through `proxy()`.
- **But** the `missing` clause means any request carrying a
  `next-router-prefetch` header, or a `purpose: prefetch` header, SKIPS the
  proxy (and therefore gets no nonce, no CSP header refresh at all for that
  particular request/response pair). If `/monitoring` is ever reached via a
  Next.js client-side **prefetch** (e.g. hovering a `<Link href="/monitoring">`
  in the nav — see `src/app/(app)/layout.tsx`, which lists `/monitoring` in
  `roleNavigation` for every role) rather than a full navigation, that
  prefetch response bypasses the proxy by design (comment at
  `src/proxy.ts:243-244`: "Prefetch requests are skipped — they don't render
  scripts and would otherwise burn a new nonce per prefetch"). **Check:**
  is the failing chunk actually loaded during a *prefetch* of `/monitoring`
  (hover) rather than the *navigation* to it (click)? DevTools Network →
  filter by the chunk name → check the request's own headers for
  `Purpose: prefetch` or `Next-Router-Prefetch: 1`. If confirmed, the
  underlying assumption in that comment ("prefetch responses don't render
  scripts") may be wrong for whatever this chunk is — a concrete, checkable
  disproof of a documented assumption, which is exactly the kind of finding
  this file exists to capture.

### Experiment 4 — the Sentry `tunnelRoute` collision (MEDIUM confidence, verified oddity)

`next.config.ts:111-114` (verified 2026-07-08):

```ts
// Route Sentry browser requests through our own /monitoring path to dodge
// ad-blockers. Keep an eye on src/proxy.ts — if any middleware starts
// matching /monitoring, client errors stop reaching Sentry.
tunnelRoute: "/monitoring",
```

This is a genuine, load-bearing fact, and it is surprising: **`/monitoring`
is doing double duty** — it's both the real fleet-dashboard page
(`src/app/(app)/monitoring/page.tsx`, a `GET` navigation) AND the path
`@sentry/nextjs` uses to tunnel error-report `POST` requests to Sentry's
ingest servers (to dodge ad-blockers that block direct `sentry.io` calls).
The comment already shows the developers know `proxy()`'s matcher **does**
match `/monitoring` (it's not excluded), and are relying on that continuing
to be true for tunneling to keep working.

This is flagged **medium confidence** because how exactly Sentry's Next.js
SDK wires `tunnelRoute` into the routing pipeline (rewrite vs. injected route
handler) was not verified against the installed `@sentry/nextjs` version's
internals — only the intent (from the comment and Sentry's documented
purpose for this option) is confirmed. **Discriminating check, don't just
theorize:**

```bash
# Compare a plain page navigation against the tunnel path's own POST traffic
curl -sI http://localhost:3000/monitoring   # GET — should be the HTML page
```
Then, with DevTools Network open while using `/monitoring` normally, look for
a `POST` request to `/monitoring` (Sentry's error/session envelope) alongside
the normal `GET` navigation, and check whether that POST response carries the
same `Content-Security-Policy` header shape as the GET (it shouldn't matter
for script execution — POST responses to an XHR/fetch aren't rendered as
HTML — but confirm nothing is rewriting the GET navigation itself through an
unexpected path). **If** you find evidence that the actual page-navigation
`GET /monitoring` is being intercepted or rewritten before reaching the
normal App Router render pipeline (rather than only the Sentry `POST`
envelope), that would explain a page-specific nonce-injection failure and
deserves its own follow-up — but do not assume this without the network
evidence above.

### Experiment 5 — Turbopack vs webpack chunk-naming (LOW confidence, flagged not resolved)

`next.config.ts:24-26` sets a top-level `turbopack: { root: ... }` block.
Next.js is `16.2.6` (verified: `package.json` line 101). Whether `npm run
build`'s plain `next build` (no `--turbopack` flag in the script, verified in
`package.json`) uses Turbopack or webpack as the default bundler for *this
installed version* was **not verified** from official docs during this
campaign's authoring — treat it as open. The prod-observed chunk name
`0c_v1-l3b~-oa.js` contains a `~` character, which is suggestive of a
chunk-merging naming convention rather than a plain content hash, but this is
a pattern-match, not a confirmed fact about this Next.js version.
**Discriminating check:** run `npm run build` and read the terminal output —
it prints which bundler compiled the app (look for a `Turbopack` banner vs.
plain webpack progress output). Record the answer here once known; it may
explain why this specific chunk behaves differently from an ordinary
same-origin chunk under `strict-dynamic` propagation.

---

## Phase 3 — Solution menu (ranked, each with a theory obligation)

**Do not apply any of these without first proving, via Phase 1/2, which one
matches the actual observed break.** Applying a solution list item without
having localized the cause is exactly the "fix blind" the owner forbade.

### 1. Ensure the nonce reaches the missing injection point (HIGHEST priority if Experiment 1 or 2 finds a nonce-less tag)

- **Theory obligation:** you must show, concretely, WHICH tag/chunk lacks the
  nonce and WHY that code path doesn't go through the request-scoped nonce
  (e.g., a Server Component that doesn't call `headers()` to read `x-nonce`
  the way `src/app/layout.tsx:85` does; a route segment with its own
  conflicting `export const dynamic`; a boundary component — `loading.tsx`,
  `not-found.tsx`, `global-error.tsx` — that Next.js renders through a
  different pipeline than the main tree).
- **Mechanism (verified in this repo):** `src/app/layout.tsx:85` reads
  `(await headers()).get('x-nonce')` and passes it as a `nonce` prop to
  `ThemeProvider`, which is the established, working pattern for getting a
  nonce onto a component-rendered inline script in this codebase. If
  Experiment 1/2 finds a specific component rendering an un-nonced
  `<script>`, the fix is almost always "read the nonce the same way
  `layout.tsx` already does, and pass it through" — not a CSP policy change
  at all.
  - If the actual gap is a **route segment not inheriting `force-dynamic`**
    (mirroring `14cc527`), the fix is adding `export const dynamic =
    'force-dynamic'` to that segment's own `layout.tsx`/`page.tsx` — but per
    Phase 0 point 4, the root layout already applies this globally, so you'd
    need to show a *more specific* segment config is overriding it before
    reaching for this fix again.

### 2. Fix caching/nonce-mismatch, not the policy (if the discriminating check in Phase 1's table found a stuck/mismatched nonce)

- **Theory obligation:** prove the HTML in the browser is stale relative to
  the CSP header of the *current* response — i.e., the nonce embedded in a
  `<script>` tag does not match the nonce in that exact response's
  `Content-Security-Policy` header. This can only happen if something cached
  a full HTML response (Caddy, a CDN, or a browser HTTP cache honoring
  `Cache-Control` on an HTML route) and later serves it verbatim against a
  freshly-generated CSP header (which changes every request, per
  `proxy()`'s `btoa(crypto.randomUUID())`).
- **Fix target:** caching headers/config (Caddy `Cache-Control` rules for
  HTML routes, any CDN config, or an over-eager client cache) — NOT
  `buildNonceCsp`. The policy is already correctly generating a fresh nonce
  per request; a caching layer serving old HTML against it is a
  caching bug, full stop.

### 3. Hash-based allowance (`'sha256-...'`) for ONE specific, stable inline bootstrap — ONLY with justification

- **When this applies:** you've localized the break to a *specific, small,
  content-stable* inline `<script>` (no `src`) that cannot practically carry
  a `nonce` prop (e.g., a third-party embed that renders its own inline
  script with no nonce hook) — NOT a dynamically-changing chunk, and NOT a
  blanket fix for "several unrelated scripts are blocked."
- **Theory obligation:** show the script's content is stable enough that a
  hash won't need updating on every build (if the content changes with every
  build/deploy, a hash allowance breaks on every deploy and you'll be back
  here). Compute the hash yourself (`openssl dgst -sha256 -binary <file> |
  openssl base64`, or read the exact string Chrome DevTools suggests when it
  blocks the script — it literally prints the correct `sha256-...` value in
  the console error) and add exactly one `'sha256-...'` token to `script-src`
  in `buildNonceCsp` — do not add a wildcard or a broader allowance.
- **Explicitly NOT for:** the Next.js runtime chunks themselves (they change
  hash every build — a moving target that hashing cannot pin) or anything
  matching the shape of the prod-observed bug (a `/_next/static/chunks/*.js`
  file) — those need Solution #1, not a hash.

### 4. Report-only shadow policy to gather more violations safely

- **When this applies:** Phase 2's experiments didn't converge on one clear
  cause, or you want production-scale evidence (real users, real browsers,
  real network conditions) without any risk of breaking anything, before
  picking a fix.
- **How, without touching the enforced policy:** add a **second**, separate
  response header, `Content-Security-Policy-Report-Only`, alongside the
  existing enforced `Content-Security-Policy` header in `proxy()`
  (`src/proxy.ts:237`) — do not replace or modify the existing header. A
  `Report-Only` policy never blocks anything; it only asks the browser to
  `POST` a JSON violation report to a `report-uri`/`report-to` endpoint you
  specify, for policies you want to *observe* without enforcing. You would
  need a new, unauthenticated endpoint to receive those reports (a small
  scope decision on its own — run it through `pilingtrack-change-control`
  before adding a new public API route) and a way to read/aggregate them
  (even a simple log line via `logger.*` is enough to start). This gives you
  a live stream of every violation across every browser hitting prod,
  without ever risking breaking a real user's page.

---

## Fenced-off wrong paths (do NOT do these — and why)

| Wrong move | Why it's wrong |
|---|---|
| **Add `'unsafe-inline'` to `script-src`** | Under `strict-dynamic`, modern browsers (which implement `strict-dynamic`) **ignore** `'unsafe-inline'` entirely when a nonce-source is present in the same directive — it does nothing for the browsers that matter. For the handful of legacy browsers that DON'T understand `strict-dynamic`, it re-opens the exact XSS surface the nonce policy exists to close. Net effect: zero fix for modern browsers, real regression for old ones. This is giving up, not fixing. |
| **Add `'self'` or an explicit host to `script-src`** | Per Phase 0: `strict-dynamic` makes the browser ignore static source expressions for script authorization. `'self'` is already present in this policy and is already inert for this purpose (Phase 0, point 1). Adding more static sources is cargo-culting a pre-`strict-dynamic` mental model onto a policy that has moved past it. |
| **Remove `strict-dynamic` entirely** | Without it, EVERY dynamically-inserted chunk (which is most of them, in a code-split Next.js app) would need its own nonce or hash, which the current architecture doesn't provide per-chunk. You'd either have to fall back to `'unsafe-inline'`/broad host allowances (see above — a real regression) or the app breaks more broadly than the one `/monitoring` chunk does today. This "fixes" the specific bug by reintroducing the much bigger vulnerability class `strict-dynamic` was added to close. |
| **Disable CSP on `/monitoring` only (route-specific bypass)** | Removes all script-injection protection on exactly the page an attacker would target if they wanted to run something in front of an operator's dashboard (which shows fleet/equipment data, not nothing-sensitive). A page-specific hole is worse than a policy gap because it's *targeted* and easy for an attacker to discover by just trying every route. |
| **Conclude "works in dev, ship it"** | Dev's CSP branch (Phase 0, point 3) has neither `strict-dynamic` nor a nonce at all — it's a structurally different policy, not a relaxed version of the same one. "Works in dev" tells you nothing about whether the prod branch's `strict-dynamic` propagation holds. Only `npm run build && npm start` (or prod itself) exercises the real policy — see Phase 1. |

---

## Phase 4 — Validate & promote

**Numeric success criterion — "looks fine" does not count as done:**

> **0 CSP violations on `/monitoring`**, confirmed across (a) a hard-reload,
> (b) in-app navigation to it from another page, and (c) a revisit after
> closing and reopening the tab (covers any caching path) — **and** the CSP
> policy string is either byte-identical to the current one, or every
> difference is listed in a directive-by-directive diff table with a written
> justification for each changed token — **and** at least the following other
> pages are re-checked clean with 0 violations in the same three ways:
> `/`, `/admin`, `/operator`, `/report`, `/history` (the five destinations
> reachable from `roleNavigation` in `src/app/(app)/layout.tsx`, so N=5
> beyond `/monitoring` itself, total N=6 pages checked).

### How to measure (not just eyeball)

1. **Violation count:** for each of the 6 pages × 3 conditions above (18
   checks total), open DevTools Console, filter for "Content Security
   Policy" or "Refused to", and confirm the filtered list is empty. Do this
   against the standalone build (`npm run build && npm start`), same as
   Phase 1 — not `next dev`.
2. **Policy diff table:** dump the CSP header before and after your change
   (`curl -sI http://localhost:3000/<path> | grep -i content-security-policy`,
   run once before your fix and once after, same nonce-stripped comparison —
   strip the `nonce-...` token itself since it's expected to differ every
   request). Split each policy string on `;` and diff directive-by-directive.
   Every directive must be either unchanged or have a one-line justification
   next to it (e.g. "+`'sha256-abc...'` — Solution #3, justified in Phase 3
   for the `<embed-name>` inline script, content-stable, verified via
   `openssl dgst`").
3. **Regression check on the other 5 pages:** don't skip this — a fix
   localized to `/monitoring`'s specific problem (e.g. a segment-level
   `dynamic` export, or a hash addition) should not need to touch anything
   shared, but confirm it didn't anyway.

### Route through change control (in order)

1. **`qa-checklist` skill** — run `npm run verify` (lint → typecheck →
   test:unit → build → smoke). If you added/changed `proxy-csp.test.ts`
   assertions, they run as part of `test:unit`.
2. **`deploy` skill** — generate the deploy block. This fix is not expected
   to touch `prisma/migrations/**`, so it should land in "Case A — нет новых
   миграций"; if your fix somehow does touch a migration, something has gone
   very wrong — re-read Phase 3, none of the four solutions there involve schema.
3. **Prod verification, operator-driven** (per `pilingtrack-run-and-operate`
   "Rule zero" — no autonomous prod actions): after deploy, the human
   operator opens `https://orionpiling.ru/monitoring` and repeats the 3
   conditions from the numeric criterion above, on the real production
   origin, in a real browser, logged in as a real role.
4. **Update `docs/audit.md`** if this closes a tracked item (consult
   `pilingtrack-docs-and-writing` for where/how — this specific bug was not
   yet a tracked audit item as of 2026-07-08, so this may be a new entry
   rather than closing an existing one; check the current file before
   assuming either way).
5. **Record the outcome** in `pilingtrack-failure-archaeology` — success or
   failure, either way. If you tried a solution from Phase 3 and it did NOT
   fully resolve the numeric criterion, record that too (which one, what
   changed, what didn't) so the next person doesn't repeat it. Update this
   file's status banner at the top (`OPEN` → `CLOSED, <commit-hash>,
   <date>`) once the numeric criterion is met and deployed.

---

## Cross-references

| Need | Skill |
|---|---|
| General change-classification rules, why any of these gates exist | `pilingtrack-change-control` |
| The exact `npm run verify` gate and change-specific checks | `qa-checklist` |
| Copy-paste deploy command block, migration auto-detection | `deploy` |
| Prod topology, health checks, "rule zero" (human drives prod) | `pilingtrack-run-and-operate` |
| Symptom-to-cause triage table (this campaign is row #8 there) | `pilingtrack-debugging-playbook` |
| Full incident narratives / where to record this campaign's outcome | `pilingtrack-failure-archaeology` |
| General (non-project-specific) debugging method | `superpowers:systematic-debugging` |
| Measuring things instead of guessing (build output, logs, load) | `pilingtrack-diagnostics-and-tooling` |
| Where to write up a fix in docs (ADR, audit entry, runbook) | `pilingtrack-docs-and-writing` |

---

## Provenance and maintenance

**Authored:** 2026-07-08, as an OPEN, unsolved campaign. No fix has been
attempted or deployed as of this date.

**Facts in this file and how to re-verify them, if this file feels stale:**

```bash
# 1. The CSP policy string hasn't changed since this was written
git log -1 --format='%H %ci' -- src/proxy.ts
sed -n '144,182p' src/proxy.ts   # compare against the quoted block in Phase 0

# 2. force-dynamic is still only set at the root layout (no competing overrides)
grep -rn "force-dynamic\|force-static" src/app

# 3. The PWA/service-worker theory is still correctly ruled out
grep -n "PWA cache headers" next.config.ts
find public -iname "sw.js" -o -iname "manifest.json"   # expect: nothing

# 4. The Sentry tunnelRoute collision still exists as described
grep -n "tunnelRoute" next.config.ts

# 5. This campaign hasn't already been closed elsewhere
#    (check pilingtrack-failure-archaeology skill for a closure note
#    referencing "monitoring" or "CSP" before repeating any phase above)

# 6. Next.js version, in case Turbopack-vs-webpack defaults changed
grep -n '"next"' package.json
```

If any of these checks disagree with what's written above, **trust the
repo, not this file** — update the relevant section (or the whole file, if
the campaign has been closed) rather than proceeding on stale assumptions.
This mirrors the project-wide rule in `pilingtrack-research-methodology`:
verify against current code before trusting any prior finding, including
this one.
