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

## 📋 Test Users

| Role | Email | Password (default) |
|------|-------|-------------------|
| ADMIN | admin@piling.ru | 1234 |
| DISPATCHER | dispatch@piling.ru | 2222 |
| OPERATOR | operator@piling.ru | 0000 |
| ASSISTANT | helper@piling.ru | 3333 |

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
