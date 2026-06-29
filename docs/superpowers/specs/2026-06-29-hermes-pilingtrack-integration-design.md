# Hermes integration for PilingTrack

## Goal

Configure the local Hermes terminal agent to work safely and effectively with the PilingTrack repository at `C:\PillingR\my-project`. Hermes must be able to inspect and edit code, run the application and its tests, and verify user flows in a browser.

## Entry point and scope

- The user interacts with Hermes through the Hermes terminal interface.
- Hermes starts project work with `C:\PillingR\my-project` as its working directory.
- The integration is project-specific and must not change Hermes behavior for unrelated repositories.
- Existing project instructions in `AGENTS.md` remain authoritative.

## Project skill

Create a managed skill at:

`C:\Users\user\.openclaw-autoclaw\skills\pilingtrack-hermes\SKILL.md`

The skill will give Hermes concise project context:

- PilingTrack is a Next.js 16, React 19, TypeScript, Prisma/PostgreSQL application.
- Main boundaries are `src/app`, `src/components`, `src/modules`, `src/services`, `src/core`, `src/mobile`, `src/workers`, and `prisma`.
- Normal development uses `start.bat` or `npm run dev`; production validation uses `npm run build` and the relevant test suites.
- Hermes must inspect existing instructions and documentation before changing behavior.
- Hermes must preserve unrelated working-tree changes.

The skill will reference the already installed PilingTrack product, domain, design-system, council, and QA skills instead of duplicating their content.

## Code workflow and safeguards

Hermes may autonomously:

- read and search project files;
- analyze architecture and execution flows;
- edit files required by an approved task;
- run targeted lint, type, unit, contract, integration, build, and smoke checks;
- start the local development application and inspect logs.

Hermes must request confirmation before:

- deleting data or files;
- resetting or migrating a database in a destructive way;
- changing production infrastructure or secrets;
- committing, pushing, or opening a pull request.

For code changes, Hermes must follow the repository's GitNexus rules: query unfamiliar flows, run upstream impact analysis before editing symbols, warn on HIGH or CRITICAL risk, and run change detection before a commit.

## Browser workflow

For browser tasks Hermes must first use the installed `autoglm-browser-agent` through its documented `mcporter` integration. The native Hermes `agent-browser`/Playwright tooling is a fallback only when AutoGLM is unavailable or fails.

The default local target is `http://localhost:3000`. Browser checks should use development accounts only and must not expose credentials in logs or summaries. UI verification should capture the visited route, action performed, observed result, and any console or network failure relevant to the task.

## Hermes configuration

Update the existing Hermes configuration without replacing model credentials or unrelated settings:

- set the terminal working directory to `C:\PillingR\my-project`;
- retain manual approval mode and destructive-operation confirmation;
- retain the CLI, terminal, file, code-execution, browser, and web capabilities needed by the workflow;
- ensure the managed OpenClaw skills directory remains discoverable by Hermes;
- add a concise project quick command only if Hermes supports it without overriding global behavior.

Before editing the global Hermes configuration, create a timestamped backup.

## Error handling

- If the application is not running, Hermes should diagnose port 3000 and offer or perform the normal development start command.
- If required infrastructure is unavailable, Hermes should identify the missing service rather than silently switching environments.
- If AutoGLM fails, Hermes should report the failure briefly and continue with `agent-browser`.
- If GitNexus reports a stale or degraded index, Hermes should repair or refresh it before relying on impact results.
- Failed checks must be reported with the exact failing command and a short cause summary.

## Verification

The setup is complete when all of the following pass:

1. `hermes doctor` reports the core terminal, file, code-execution, and browser tools available.
2. Hermes launched from its normal terminal reports `C:\PillingR\my-project` as the current project directory.
3. Hermes discovers the `pilingtrack-hermes` skill and can summarize the project's architecture and safety rules.
4. Hermes can run a harmless repository check such as `git status --short` and a targeted test command.
5. With PilingTrack running locally, Hermes can open `http://localhost:3000` using AutoGLM; if AutoGLM is deliberately unavailable, the documented fallback succeeds.
6. Hermes asks for approval rather than executing a simulated commit, push, destructive database command, or file deletion.

## Non-goals

- Automatic commits, pushes, deployments, or production changes.
- Replacing the configured Hermes model or API provider.
- Storing application credentials in the project skill.
- Changing PilingTrack application code solely to support Hermes.
