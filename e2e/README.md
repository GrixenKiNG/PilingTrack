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
# Одноразовый QA-набор (195 сценариев)

`playwright.qa-disposable.config.ts` собирает те же 65 сценариев в Chromium,
Mobile Safari и Mobile Chrome. Один worker, без повторов, общий предел — 90 минут.
Обходы ролей имеют отдельный предел 8 минут. Остальные сценарии сохраняют свои
явные пределы; глобальный предел действует на весь запуск.

Запускайте `node e2e/fixtures/disposable-qa.mjs` **через командный канал собственного
`scripts/test-day-stand.cjs`**, чтобы процесс унаследовал адреса, случайные пароли
БД и ключи только этого стенда. Предварительно поднимите БД через
`scripts/test-db-up.sh` и с её `INTEGRATION_DATABASE_URL_APP` выполните
`npm run db:generate`. Для полного экспорта нужен `CODEX_WITH_S3=true`.
Пример команды в `output/codex-t5/stand-command.json`:

```json
{"id":"qa-195","args":["e2e/fixtures/disposable-qa.mjs"]}
```

Fixture проверяет loopback-адреса и Docker-метку одноразовой БД, создаёт собственных
пользователей со случайными адресами и паролями, справочники и семь бригад.
Пароли передаются в памяти через `QA_CREDENTIALS_JSON`; внешний
`.credentials.json` не читается. `QA_MATRIX_JSON` и `QA_ACCOUNT_ALIASES_JSON`
связывают старые сценарии с этими тестовыми пользователями. SQL-проверки работают
только в помеченном контейнере и транзакции `READ ONLY`.

Результаты и сессии находятся в `output/qa-stabilize-1023/`.
Для одного безопасного сбора вместо запуска добавьте `"--list"` в `args`.
Исторические пропуски не являются успешными проверками: их конкретные
предусловия нужно восстановить на этом же одноразовом стенде.
