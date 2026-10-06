# 🧪 PilingTrack E2E Tests

## 📁 Structure

```
e2e/
├── tests/
│   ├── login.spec.ts          # Login flow tests
│   └── shift.spec.ts          # Shift & report flow tests
├── page-objects/
│   ├── login.page.ts          # Login Page Object
│   └── dashboard.page.ts      # Dashboard Page Object
├── fixtures/
│   └── auth.fixture.ts        # Auth state & test users
├── global-setup.ts            # Pre-test authentication
└── .auth/                     # Auth state files (auto-generated)
```

## 🚀 Quick Start

```bash
# Run all E2E tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test e2e/tests/login.spec.ts

# Run on mobile
npx playwright test --project="Mobile Safari"

# Run with trace
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

## Disposable stand (T5)

Run `bash scripts/test-day-stand.sh` from Git Bash. It creates only codex-pg and two codex-redis containers, applies all migrations and identity/app grants, seeds own accounts, generates secrets in memory, builds production Next, starts Next and unified workers.

The supervisor waits for `output/codex-t5/stand-command.json`. To run every spec, write this JSON (UTF-8 without BOM):

```json
{"id":"playwright-all","args":["e2e/fixtures/disposable-https.mjs","node_modules/@playwright/test/cli.js","test","--workers=1","--reporter=line"]}
```

Wait for `playwright-all-result.json` (real exit) and read `playwright-all.log`. Write `{"stop":true}` to the command file after a completed command: only owned children/containers are removed. Do not interrupt the shell instead of requesting cleanup.

Accounts and passwords come from E2E_ROLE_EMAIL/E2E_ROLE_PASSWORD injected by the supervisor; passwords never go to disk. HTTPS certificate/key are ephemeral in memory, allowing production Secure cookies in WebKit and API contexts. Requires existing Git OpenSSL, postgres:16, redis:7-alpine and installed Playwright browsers; no downloads. TRUST_PROXY is enabled only in this disposable stand; each spec gets a separate IP bucket, while repeated requests inside one test still enforce 429. Do not use this harness against production. Key-path tests mutate seeded data and run once in Chromium; start a fresh stand for a repeat. Existing mobile specs remain collected.

For the real photo/PDF storage workflow, tag the existing pinned local image first:

```bash
docker tag minio/minio:RELEASE.2024-09-13T20-26-02Z codex-s3-t5:e7
CODEX_WITH_S3=true bash scripts/test-day-stand.sh
```

This optional mode adds only an owned codex-s3 container, a real bucket and a local HTTPS proxy. The private TLS key and S3 credentials stay in memory. The public CA certificate is the only certificate file written; child Node processes trust it through NODE_EXTRA_CA_CERTS, and cleanup removes it. E2E_S3_READY is set by the supervisor only after a real signed PUT/GET/DELETE round trip. Without that fixture the photo test explicitly skips. Remove the owned codex-s3-t5:e7 image tag after cleanup. No S3 mock and no TLS verification bypass are used.

## 🎯 Projects

| Project | Browser | Use Case |
|---------|---------|----------|
| `chromium` | Desktop Chrome | Primary testing |
| `Mobile Safari` | iPhone 13 | Responsive |
| `Mobile Chrome` | Galaxy S20 | Responsive |
| `unauthenticated` | Desktop Chrome | Login tests |

## 🔧 CI Integration

```yaml
- name: Run E2E tests
  run: npx playwright test --reporter=html

- name: Upload report
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: e2e-report
    path: playwright-report/
```
