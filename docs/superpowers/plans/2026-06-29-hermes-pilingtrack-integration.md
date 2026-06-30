# Hermes PilingTrack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the local Hermes terminal agent to develop, test, and browser-verify PilingTrack from `C:\PillingR\my-project` with explicit approval gates for destructive and publishing actions.

**Architecture:** Keep repository rules in `AGENTS.md` as the always-loaded project context, add one discoverable managed skill for PilingTrack-specific workflows, and change only the Hermes working-directory and external-skill-directory settings. Route browser work through AutoGLM's `browser_subagent` first, with Hermes `agent-browser` as a documented fallback.

**Tech Stack:** Hermes Agent 0.16.0, YAML configuration, Markdown skills, PowerShell, AutoGLM MCP/mcporter, Next.js 16, TypeScript, Prisma, Vitest, Playwright, GitNexus.

## Global Constraints

- Preserve all pre-existing user changes in `AGENTS.md`, `CLAUDE.md`, `docs/superpowers/plans/2026-06-28-admin-command-center-dashboard.md`, and `reports/`.
- Install this skill only at `C:\Users\user\.openclaw-autoclaw\skills\pilingtrack-hermes\SKILL.md`.
- Do not modify Hermes model credentials, provider settings, or unrelated configuration.
- Keep `approvals.mode: manual` and `approvals.destructive_slash_confirm: true`.
- Ask before deletion, destructive database operations, production changes, commit, push, pull request, or deployment.
- For browser tasks, use `autoglm-browser-agent` first and Hermes `agent-browser` only after AutoGLM is unavailable or fails.
- Follow `AGENTS.md`: run GitNexus upstream impact before editing code symbols and `gitnexus_detect_changes()` before any commit.
- Do not store application credentials in skills, plans, logs, or summaries.

## File Structure

- Create outside repository: `C:\Users\user\.openclaw-autoclaw\skills\pilingtrack-hermes\SKILL.md` — project workflow and safety contract discovered by Hermes.
- Modify outside repository: `C:\Users\user\AppData\Local\hermes\config.yaml` — set project cwd and managed skills directory only.
- Create outside repository: `C:\Users\user\AppData\Local\hermes\config.yaml.bak.pilingtrack-20260629` — exact pre-change backup.
- Create outside repository if absent: `C:\Users\user\.openclaw-autoclaw\config.json` — AutoGLM browser preference, extension confirmation, and trust mode.
- Temporary staging only: `C:\tmp\pilingtrack-hermes\SKILL.md` and `C:\tmp\pilingtrack-hermes-autoglm-config.json` — content created with `apply_patch` before approved copies into managed directories.

---

### Task 1: Create and validate the managed PilingTrack skill

**Files:**
- Create: `C:\tmp\pilingtrack-hermes\SKILL.md`
- Create: `C:\Users\user\.openclaw-autoclaw\skills\pilingtrack-hermes\SKILL.md`

**Interfaces:**
- Consumes: repository instructions from `C:\PillingR\my-project\AGENTS.md` and installed skills `pilingtrack-product-bible`, `pilingtrack-domain-glossary`, `pilingtrack-design-system`, `pilingtrack-council`, `pilingtrack-qa-checklist`, and `autoglm-browser-agent`.
- Produces: Hermes skill named `pilingtrack-hermes`, discoverable from the managed skills root.

- [ ] **Step 1: Load the skill-authoring rules**

Read the current `skill-creator` skill completely before creating the file. Follow its validation requirements, while honoring the repository override that the destination is `C:\Users\user\.openclaw-autoclaw\skills`.

- [ ] **Step 2: Create the staged skill with `apply_patch`**

Create `C:\tmp\pilingtrack-hermes\SKILL.md` with this complete content:

```markdown
---
name: pilingtrack-hermes
description: Use when working on the PilingTrack application in C:\PillingR\my-project, including code changes, tests, local startup, architecture analysis, or browser verification.
---

# PilingTrack Hermes Workflow

Work from `C:\PillingR\my-project`. Read and obey `AGENTS.md` before acting; it is the authoritative project context.

## Project map

- `src/app`: Next.js App Router pages and API routes
- `src/components`: UI and application screens
- `src/modules`: bounded contexts and domain logic
- `src/services`: orchestration and integrations
- `src/core`: platform infrastructure, reliability, outbox, and observability
- `src/mobile`: offline-first client and synchronization
- `src/workers`: background worker entry points
- `prisma`: database schema, migrations, and seed data

Load the relevant installed PilingTrack skills for product, domain, design, council, QA, and report-evidence context instead of duplicating their rules.

## Development workflow

1. Inspect `git status --short` and preserve unrelated changes.
2. Use GitNexus query for unfamiliar flows and upstream impact before editing a function, class, or method.
3. Warn and wait if impact risk is HIGH or CRITICAL.
4. Make the smallest task-scoped change.
5. Run the narrowest relevant check, then broaden to `npm run test:unit`, `npm run test:contract`, `npm run test:integration`, or `npm run build` as risk requires.
6. Run GitNexus change detection before requesting permission to commit.

Use `start.bat` or `npm run dev` for normal local development at `http://localhost:3000`. Do not start duplicate workers alongside the dev stack.

## Browser workflow

For every browser task, first load and follow `autoglm-browser-agent` and call its `browser_subagent` through the bundled `mcporter`. Use Hermes `agent-browser` or Playwright only when AutoGLM is unavailable or has failed, and report the fallback.

Record the route, action, observed result, and relevant console or network failures. Never expose credentials.

## Approval gates

You may read, edit task-scoped files, run checks, start the local app, and inspect logs. Ask before deleting files or data, destructive database changes, production or secret changes, commit, push, pull request, or deployment.
```

- [ ] **Step 3: Validate the staged skill**

Run:

```powershell
python C:\Users\user\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\tmp\pilingtrack-hermes
```

Expected: validation succeeds with no YAML frontmatter or naming errors.

- [ ] **Step 4: Copy the validated skill into the managed directory**

After filesystem approval, create `C:\Users\user\.openclaw-autoclaw\skills\pilingtrack-hermes` and copy only the validated `SKILL.md` into it. Re-read the destination and verify its SHA-256 matches the staged file.

- [ ] **Step 5: Verify no repository files changed**

Run `git status --short` in `C:\PillingR\my-project` and confirm Task 1 added no repository changes.

### Task 2: Back up and minimally configure Hermes

**Files:**
- Create: `C:\Users\user\AppData\Local\hermes\config.yaml.bak.pilingtrack-20260629`
- Modify: `C:\Users\user\AppData\Local\hermes\config.yaml`

**Interfaces:**
- Consumes: managed skill root from Task 1.
- Produces: Hermes default cwd `C:\PillingR\my-project` and external skill root `C:\Users\user\.openclaw-autoclaw\skills`.

- [ ] **Step 1: Snapshot and inspect current values**

Print only `terminal.cwd`, `skills.external_dirs`, `approvals.mode`, and `approvals.destructive_slash_confirm`; do not print secrets. Copy `config.yaml` to `config.yaml.bak.pilingtrack-20260629`, refusing to overwrite if it already exists, then verify the backup hash equals the original pre-change hash.

- [ ] **Step 2: Set the project working directory through Hermes**

Run:

```powershell
& 'C:\Users\user\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe' config set terminal.cwd 'C:\PillingR\my-project'
```

Expected: Hermes reports `terminal.cwd` was set in `config.yaml`.

- [ ] **Step 3: Add the managed skills root through Hermes**

The current `skills.external_dirs` list is empty. Run:

```powershell
& 'C:\Users\user\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe' config set skills.external_dirs.0 'C:\Users\user\.openclaw-autoclaw\skills'
```

Expected: Hermes reports the indexed setting was written without altering model/provider fields.

- [ ] **Step 4: Verify the minimal diff**

Compare parsed pre-change and post-change YAML after removing `terminal.cwd` and `skills.external_dirs`; the remaining structures must be equal. Confirm approval settings remain `manual` and `true`.

- [ ] **Step 5: Validate Hermes configuration and skill discovery**

Run `hermes config check`, `hermes doctor`, and `hermes skills list`. Expected: core terminal/file/code-execution/browser tools are available and both `pilingtrack-hermes` and `autoglm-browser-agent` appear as enabled external skills.

### Task 3: Configure and register AutoGLM safely

**Files:**
- Create: `C:\tmp\pilingtrack-hermes-autoglm-config.json`
- Create or modify: `C:\Users\user\.openclaw-autoclaw\config.json`
- Modify through mcporter: its AutoGLM MCP registry entry.

**Interfaces:**
- Consumes: `autoglm-browser-agent` installed at `C:\Users\user\.openclaw-autoclaw\skills\autoglm-browser-agent`.
- Produces: browser preference, extension confirmation, trust setting, registered MCP server, and running relay on port 62031.

- [ ] **Step 1: Collect the required first-use choices**

The AutoGLM config is currently absent. Ask the user in one message for: Chrome or Edge; Trust Mode off or on; and confirmation that the matching AutoGLM extension is installed and enabled. Recommend Trust Mode off to match the approved safety model. Do not call `browser_subagent` before all three values exist.

- [ ] **Step 2: Stage and install the AutoGLM config**

Create the staged JSON with `apply_patch`. If the user chooses Chrome, use:

```json
{
  "browser": "chrome",
  "extension_confirmed": true,
  "auto_approve": false
}
```

If the user chooses Edge, use:

```json
{
  "browser": "edge",
  "extension_confirmed": true,
  "auto_approve": false
}
```

If the user explicitly enables Trust Mode, change only `auto_approve` to `true` in the chosen branch.

If the destination appears before installation, merge these three fields instead of overwriting unrelated fields. After filesystem approval, copy the merged JSON to `C:\Users\user\.openclaw-autoclaw\config.json` and parse it to verify all three values.

- [ ] **Step 3: Register the AutoGLM MCP server**

Run the single-line Windows registration command from the installed skill, substituting `{baseDir}` with `C:\Users\user\.openclaw-autoclaw\skills\autoglm-browser-agent` exactly.

- [ ] **Step 4: Start and verify the relay**

Start `dist\relay.exe` hidden, then verify port 62031 is listening. Run:

```powershell
& 'C:\Users\user\.openclaw-autoclaw\skills\autoglm-browser-agent\dependency\mcporter.exe' list autoglm-browser-agent --schema
```

Expected: schema includes `browser_subagent` and `close_browser`.

### Task 4: End-to-end verification and handoff

**Files:**
- No intended file changes.

**Interfaces:**
- Consumes: configured Hermes and AutoGLM from Tasks 1-3.
- Produces: evidence that code, test, browser, and approval workflows operate as designed.

- [ ] **Step 1: Refresh degraded GitNexus metadata**

Run `npx gitnexus analyze --repair-fts` from `C:\PillingR\my-project`. If the installed CLI does not support `--repair-fts`, run `npx gitnexus analyze --force`. Expected: the index matches the current repository commit and no stale-index warning remains.

- [ ] **Step 2: Verify repository access and a targeted check**

From the Hermes-configured project directory, run `git status --short` and a low-cost targeted check such as `npm run validate:env`. Record pass/fail without modifying application data. If environment validation requires unavailable local infrastructure or secrets, report that exact prerequisite and use `npm run check:text-integrity` as the harmless fallback.

- [ ] **Step 3: Verify project context and skill visibility**

Start a fresh Hermes terminal session. Confirm its cwd is `C:\PillingR\my-project`, `AGENTS.md` is loaded as project context, and `pilingtrack-hermes` can be selected for a request to explain the project workflow.

- [ ] **Step 4: Run the AutoGLM browser smoke test**

Ensure PilingTrack is available at `http://localhost:3000`. Before the call, register the MCP service and start the relay again as required by the skill. Call `browser_subagent` with the user's exact smoke-test wording, a two-hour timeout, and `start_url="http://localhost:3000"`. Include the returned screenshot in the result. If AutoGLM fails, report the failure and repeat the smoke check with Hermes `agent-browser`/Playwright.

- [ ] **Step 5: Verify approval boundaries without side effects**

Ask Hermes to describe what it would do for `git commit`, `git push`, file deletion, and a destructive Prisma reset, explicitly instructing it not to execute anything. Expected: Hermes says it must ask for confirmation for each operation.

- [ ] **Step 6: Run final diagnostics and report**

Run `hermes doctor` and `git status --short`. Summarize configured paths, successful checks, any fallback used, and remaining non-blocking doctor warnings. Do not commit configuration or skill changes unless the user separately approves a commit.
