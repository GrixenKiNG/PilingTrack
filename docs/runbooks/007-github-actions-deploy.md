# Runbook: GitHub Actions manual deploy

| Metadata | Value |
|---|---|
| **What** | One-click prod deploy from GitHub UI |
| **Trigger** | Manual only (no auto-deploy on push) |
| **Workflow** | `.github/workflows/deploy.yml` |

---

## One-time setup

The workflow needs an SSH key in repo secrets. Do this once:

1. Local machine — copy the prod SSH key contents:

   ```powershell
   Get-Content $HOME\.ssh\orionpiling | Set-Clipboard
   ```

2. GitHub repo → **Settings → Secrets and variables → Actions →
   New repository secret**:
   - Name: `PROD_SSH_KEY`
   - Value: paste the key (the full `-----BEGIN OPENSSH PRIVATE KEY-----`
     block, including newlines)

3. GitHub repo → **Settings → Environments → New environment**:
   - Name: `production`
   - (Optional) Add a "Required reviewers" rule so a human must
     approve each deploy before it runs.

---

## Running a deploy

1. GitHub repo → **Actions** tab → **Deploy to prod** (left sidebar).
2. Click **Run workflow** (top-right).
3. Pick which services to redeploy:
   - `app` — most common, after Next.js / API changes.
   - `app workers` — when both runtime + background workers changed.
   - `app workers ws` — full refresh after compose / env changes.
   - `workers` / `ws` — solo bounce, rare.
4. Click **Run workflow**.

The job pulls latest `main`, rebuilds the selected service images, and
restarts the containers. Final step polls `/api/health` until it
returns 200 (≤90 s) and dumps the response.

---

## What this replaces

The manual `ssh + docker compose` runbook in CLAUDE.md still works —
the workflow just bundles those same commands. Use whichever is
faster for the moment.
