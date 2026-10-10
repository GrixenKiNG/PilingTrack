# Runbook: GitHub Actions manual deploy

| Metadata | Value |
|---|---|
| **What** | One-click prod deploy from GitHub UI |
| **Trigger** | Manual only (no auto-deploy on push) |
| **Workflow** | `.github/workflows/deploy.yml` |

---

## One-time setup

Do this once before the first trial. Repository files cannot prove these GitHub settings are active.

1. Local machine — copy the prod SSH key contents:

   ```powershell
   Get-Content $HOME\.ssh\orionpiling | Set-Clipboard
   ```

2. GitHub repo → **Settings → Environments → production → Environment secrets**:
   - Name: `PROD_SSH_KEY`
   - Value: paste the key (the full `-----BEGIN OPENSSH PRIVATE KEY-----`
     block, including newlines)

   - Add `PROD_SSH_KNOWN_HOSTS`: the verified known_hosts entry for `87.242.102.125`.
     Obtain the host public key/fingerprint through a trusted server console or an
     independently verified existing connection. Compare the fingerprint out of band
     before saving the entry. An unverified `ssh-keyscan` response is not trusted.

3. Configure environment `production`:
   - **Required reviewers**: the owner only. This rule is mandatory.
   - Disable **Allow administrators to bypass configured protection rules**.
   - **Deployment branches and tags**: selected branch `main` only, no tags.
   - Leave **Prevent self-review** disabled: the owner dispatches and then approves
     the same run. The workflow rejects dispatches and re-runs by other accounts.
   - Confirm that the repository's plan and visibility support required reviewers.
     If they do not, do not enable this production workflow.

4. **Settings → Secrets and variables → Actions → Variables**: create repository
   variable `PROD_DEPLOY_OWNER` with the owner's GitHub login. It must be a repository
   variable because the job gate runs before environment variables are available.
   An empty value, another actor/re-run actor, or another branch skips the deploy job.
   `github.token` is automatic; no `GH_TOKEN` secret is needed. The workflow requests
   only `contents: read` and `actions: read`.

---

## Running a deploy

1. GitHub repo → **Actions** tab → **Deploy to prod** (left sidebar).
2. Click **Run workflow** (top-right).
3. Select branch `main` and enter its current full 40-character SHA. Its latest
   push CI run must have completed successfully. The runner and server both check
   the exact current `origin/main`; an older ancestor SHA is rejected.
4. Stop and verify all external workers and their auto-restart, then confirm
   `external_workers_stopped`. See runbooks 008/016 for the complete barrier.
5. Pick `app`, `app workers`, or `workers`. Every choice replaces **app and workers
   together**. There is no `ws` service. `migrate` is always built and shipped too,
   so migration execution cannot use a stale image.
6. Click **Run workflow**, then approve the waiting `production` job as the owner.

The job builds SHA-tagged images on the GitHub runner and tests that exact workers
image before its first SSH. It saves the actual running image IDs as rollback tags,
streams the ready images to the server, fast-forwards its clean `main` checkout,
and invokes the shared STOP → VERIFY → START generation barrier. Both runner and
server must have a clean tracked tree; the server must already be on `main` (restore
that explicitly before a first trial if an older workflow left detached HEAD).
No image is built on the VPS. The final step requires `/api/health` to report the
requested full SHA within 30 attempts. This is a version check; complete the broader
post-deploy checks in runbooks 008/016 before accepting the release.

---

## What this replaces

The manual `ssh + docker compose` runbook in CLAUDE.md still works —
the workflow just bundles those same commands. Use whichever is
faster for the moment.
