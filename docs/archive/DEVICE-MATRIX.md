# Device Matrix — PilingTrack

Устройство тестируется на реальных устройствах, не только эмуляторах.

## Tier 1 — Blocking Release (тестируется перед каждым релизом)

| Устройство | Браузер | OS | Приоритет |
|-----------|---------|----|-----------|
| iPhone 13+ | Safari 16+ | iOS 16+ | 🔴 Critical |
| iPhone SE (2022) | Safari 16+ | iOS 16+ | 🔴 Critical |
| Samsung Galaxy A54 | Chrome 120+ | Android 14 | 🔴 Critical |
| Google Pixel 7 | Chrome 120+ | Android 14 | 🔴 Critical |

**Тесты для Tier 1:**
- ✅ Offline-first (offline-sync.spec.ts)
- ✅ Network chaos (network-chaos.spec.ts)
- ✅ Sync correctness (sync-correctness.spec.ts)
- ✅ Conflict resolution (conflict-resolution.spec.ts)
- ✅ Keyboard overlays (input фокус не перекрывает поля)
- ✅ Touch events (свайпы, тапы работают корректно)
- ✅ Performance (LCP < 2.5s на 3G)

---

## Tier 2 — Nightly Testing (тестируется каждую ночь в CI)

| Устройство | Браузер | OS | Приоритет |
|-----------|---------|----|-----------|
| Samsung Galaxy S21 | Samsung Internet 22+ | Android 13 | 🟡 High |
| Xiaomi Redmi Note 12 | Chrome 115+ | Android 13 | 🟡 High |
| iPhone 11 | Safari 15+ | iOS 15 | 🟡 High |
| Huawei P40 | Huawei Browser | Android 10 | 🟡 High |

**Тесты для Tier 2:**
- ✅ Все Tier 1 тесты
- ✅ Старые WebView (Android WebView 90+)
- ✅ Battery/performance monitoring
- ✅ Service Worker compatibility

---

## Tier 3 — Periodic Testing (раз в спринт)

| Устройство | Браузер | OS | Приоритет |
|-----------|---------|----|-----------|
| Low-end Android (2GB RAM) | Chrome 100+ | Android 10 | 🟢 Medium |
| iPad (9th gen) | Safari 16+ | iPadOS 16 | 🟢 Medium |
| Windows Tablet | Edge 120+ | Windows 11 | 🟢 Medium |

**Тесты для Tier 3:**
- ✅ Performance на low-end устройствах
- ✅ Memory leaks (долгие сессии)
- ✅ Storage limits (IndexedDB квоты)
- ✅ Background sync reliability

---

## Специфические тесты для стройки/поля

### Keyboard Overlays
- [ ] Input фокус не перекрывает поле ввода
- [ ] Numpad для числовых полей (количество свай, метры)
- [ ] Автозакрытие клавиатуры после submit

### Touch Events
- [ ] Свайп для навигации между отчётами
- [ ] Long press для контекстного меню
- [ ] Pinch-to-zoom для схем/чертежей
- [ ] Tap targets минимум 44x44px

### Network Conditions
- [ ] Работа на 2G/3G ( latency > 500ms)
- [ ] Reconnect после потери сети
- [ ] Sync progress indicator
- [ ] Offline indicator visible always

### Battery/Performance
- [ ] Background sync не разряжает батарею
- [ ] Service Worker не потребляет > 50MB RAM
- [ ] IndexedDB не превышает квоту (обычно 50MB)
- [ ] Холодный старт < 3s на 3G

### Security
- [ ] Service Worker cache poisoning protection
- [ ] Offline data encryption (если требуется)
- [ ] Auth token secure storage (HttpOnly cookies)
- [ ] No sensitive data in localStorage

---

## CI Integration

```yaml
# .github/workflows/device-tests.yml
name: Device Tests
on:
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM
  workflow_dispatch:

jobs:
  tier1-tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        device:
          - { name: 'iPhone 13', browser: 'safari', os: 'ios-16' }
          - { name: 'Samsung A54', browser: 'chrome', os: 'android-14' }
    steps:
      - uses: actions/checkout@v4
      - name: Run Playwright tests
        uses: playwright-community/install-playwright@v2
        with:
          browsers: 'chromium'
      - run: npx playwright test tests/e2e/ --project=${{ matrix.device.browser }}

  tier2-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    strategy:
      matrix:
        device:
          - { name: 'Samsung S21', browser: 'samsung-internet', os: 'android-13' }
          - { name: 'Xiaomi Note 12', browser: 'chrome', os: 'android-13' }
    steps:
      - uses: actions/checkout@v4
      - name: Run Playwright tests
        uses: playwright-community/install-playwright@v2
        with:
          browsers: 'chromium'
      - run: npx playwright test tests/e2e/ --project=${{ matrix.device.browser }}
```

---

## Testing Checklist per Release

- [ ] All Tier 1 devices pass offline-sync tests
- [ ] All Tier 1 devices pass network-chaos tests
- [ ] All Tier 1 devices pass sync-correctness tests
- [ ] All Tier 1 devices pass conflict-resolution tests
- [ ] Lighthouse performance score ≥ 0.75
- [ ] Lighthouse accessibility score ≥ 0.90
- [ ] No keyboard overlay issues
- [ ] No touch event issues
- [ ] Sync works on 3G (latency > 500ms)
- [ ] No battery drain issues (background sync < 5% per hour)
- [ ] No memory leaks (Service Worker < 50MB after 1 hour)
- [ ] IndexedDB within quota (< 50MB)
