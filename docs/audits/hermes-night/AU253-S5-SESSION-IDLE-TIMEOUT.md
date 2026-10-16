# AU253-S5-SESSION-IDLE-TIMEOUT: Таймаут простоя сессии

**Версия кода (git rev-parse HEAD):** cda9891e453590b82d0616d187b54b09d37c48f3  
**Дата аудита:** 2026-10-11  
**Тип:** Только чтение (read-only), код не менялся

---

## Итог

| Критично | Важно | Мелочь | Не проверено |
|----------|-------|--------|--------------|
| 2        | 3     | 1      | 2            |

**Топ-5 находок:**
1. **Критично** — Серверный TTL сессии 12 часов жестко задан в коде (`SESSION_TTL_SECONDS = 43200`), не конфигурируется через env; нет sliding expiration — токен не продлевается при активности.
2. **Критично** — Нет никакого механизма idle timeout: сессия живёт 12 часов независимо от активности пользователя. Оператор может оставить вкладку открытой на смену, уйти, вернуться — сессия валидна.
3. **Важно** — Нет предупреждения перед истечением сессии (нет модалки «через N минут выйдете», нет продления по движению мыши/клавиатуры).
4. **Важно** — При принудительном выходе (401) черновик отчёта сохраняется в `localStorage` (TTL 24ч), но **только** в форме отчёта (`use-report-form.ts`). Другие формы (наряды, чек-листы, админские диалоги) не имеют автосохранения черновиков.
5. **Важно** — Политика отзыва токенов fail-open: при недоступности Redis отозванный токен остаётся валидным до естественного истечения (до 12 часов). Документировано в `session-service.ts:91-140`.

---

## Методика

Поиск осуществлялся в репозитории `D:/PillingR/wt-night` (ветка `hermes/q4-0926`) командами:
- `rg` / `search_files` по паттернам: `idle`, `timeout`, `session.*warn`, `warn.*session`, `activity`, `lastActivity`, `beforeunload`, `draft`, `SESSION_TTL`, `sliding`, `refresh.*token`, `renew.*session`
- Чтение ключевых файлов: `src/services/auth/session-service.ts`, `src/services/auth/auth-service.ts`, `src/lib/auth.ts`, `src/lib/api.ts`, `src/app/(app)/layout.tsx`, `src/components/piling/report-form/use-report-form.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/auth/logout/route.ts`, `src/lib/store.ts`, `src/proxy.ts`
- Проверка отсутствия: middleware для сессий, клиентского периодического пробирования `/api/auth/me`, sliding expiration, конфигурации TTL через env

Исключены замороженные зоны (AGENTS.md): `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`.

---

## Находки

| # | Сериозность | Место (файл:строка) | Срок простоя | Предупреждение | Риск / Сценарий | Предлагаемое исправление |
|---|-------------|---------------------|--------------|----------------|-----------------|--------------------------|
| 1 | **Критично** | `src/services/auth/session-service.ts:8` | 12 часов (43200 сек) — жестко в коде | Нет | TTL не настраивается без пересборки. Нет sliding expiration — активность не продлевает сессию. Оператор, оставивший вкладку на смену, остаётся залогиненным 12 ч. | Вынести `SESSION_TTL_SECONDS` в env (`SESSION_TTL_SECONDS` или `SESSION_TTL_HOURS`). Добавить sliding expiration: при каждом успешном `requireAuth` / `probeSession` перевыпускать токен с новым exp (или обновлять cookie `maxAge`). |
| 2 | **Критично** | `src/services/auth/session-service.ts:207` (токен), `src/services/auth/session-service.ts:287` (cookie) | 12 часов | Нет | Cookie `maxAge` = 12 ч, HttpOnly, SameSite=lax. Нет механизма idle timeout вообще. | Ввести понятие «idle timeout» (например, 30 мин неактивности) отдельно от абсолютного TTL. Требует клиентского трекера активности + серверной проверки `lastActivityAt` в токене/Redis. |
| 3 | **Важно** | `src/app/(app)/layout.tsx:305-343` (bootstrap probe) | — | Нет | Проверка сессии только при загрузке приложения (`probeSession` → `/api/auth/me`). Нет периодической перепроверки в фоне. Если токен истекает во вкладке — пользователь узнает только при следующем запросе (401). | Добавить периодический `setInterval(probeSession, 5 мин)` в клиентском хранилище/хуке. При 401 — показать модалку «Сессия истекла, войдите снова» с сохранением контекста. |
| 4 | **Важно** | `src/lib/api.ts:57-70` (authFetch 401 handling) | — | Только тост «Сессия истекла — войдите снова» ПОСЛЕ факта | При 401 клиент делает logout + редирект на `/login`. Нет предварительного предупреждения. Нет возможности «продлить сессию» одной кнопкой. | Добавить клиентский таймер до `exp` из токена (JWT `exp` доступен при декодировании payload). За 2-5 мин до истечения показывать модалку с кнопкой «Продлить» (вызов `/api/auth/refresh` — нужен новый эндпоинт). |
| 5 | **Важно** | `src/components/piling/report-form/use-report-form.ts:268-303` (draft save) | Черновик в localStorage живёт 24 ч (`use-report-form.ts:320`) | Нет (автосохранение на `beforeunload` и по дебаунсу 800 мс) | **Только** форма отчёта (`/operator`) сохраняет черновик. Админские формы (наряды, чек-листы, справочники), диалоги оборудования, layout editor — **нет**. При выходе по 401 или закрытии вкладки в этих формах данные теряются. | Унифицировать автосохранение черновиков: общий хук `useDraft(key, data, ttlHours?)` + провайдер контекста. Применять ко всем формам ввода. |
| 6 | **Важно** | `src/services/auth/session-service.ts:91-140` (RedisRevocationStore) | До 12 часов (при fail-open) | Нет | При недоступности Redis `isRevoked()` возвращает `false` (fail-open). Отозванная админская сессия остаётся валидной до естественного истечения токена. Это документированное решение (аудит Codex out55, F02), но расширяет окно уязвимости. | Рассмотреть fail-closed для привилегированных ролей (ADMIN/DISPATCHER) или короткий TTL (1-2 ч) + sliding renewal. Добавить метрику `session.revoked_fail_open`. |
| 7 | **Мелочь** | `src/lib/auth.ts:41` (AUTH_USER_CACHE_TTL_MS = 5000) | Кэш пользователя 5 сек | — | Кэш `requireAuth` на 5 сек смягчает нагрузку на БД, но означает: после отзыва токена / смены роли / деактивации пользователя — до 5 сек старые права действуют в текущем процессе. | Значение разумное для нагрузки. Если нужно жёстче — снизить до 1-2 сек или инвалидировать кэш при критичных действиях (уже есть `clearAuthUserCacheEntry` на logout). |

---

## Не проверено

| Область | Причина |
|---------|---------|
| Влияние `SESSION_SECRET` на валидность существующих токенов при ротации секрета | Не найдено кода ротации секрета; при смене `SESSION_SECRET` все токены станут невалидны мгновенно — массовый логаут. Требует отдельного плана миграции. |
| Поведение при `MULTI_TENANT_MODE=true` с поддоменами | Проверяется только в `src/proxy.ts:86-135` (tenant enforcement), связь с сессией не трассировалась — нет задачи на мультитенантность. |
| Playwright e2e сценарии простой сессии | Не запускались (требуют env/DB). `npx playwright test --list` не выполнялся. |

---

## Приложение: таблица мест (только путь:строка)

```
src/services/auth/session-service.ts:8          # SESSION_TTL_SECONDS = 12h
src/services/auth/session-service.ts:207        # JWT exp = 12h
src/services/auth/session-service.ts:287        # Cookie maxAge = 12h
src/services/auth/session-service.ts:91-140     # RedisRevocationStore (fail-open)
src/services/auth/session-service.ts:253        # Комментарий: токены v1 живут 12h
src/lib/auth.ts:41                              # AUTH_USER_CACHE_TTL_MS = 5s
src/lib/auth.ts:158-212                         # requireAuth — валидация токена
src/lib/api.ts:176-193                          # probeSession — проверка /api/auth/me
src/lib/api.ts:57-70                            # authFetch 401 handling
src/app/(app)/layout.tsx:305-343                # Bootstrap session check
src/app/(app)/layout.tsx:349-353                # Redirect to /login если нет юзера
src/components/piling/report-form/use-report-form.ts:268-303  # Draft auto-save
src/components/piling/report-form/use-report-form.ts:312-343  # Draft restore (24h TTL)
src/components/piling/report-form/use-report-form.ts:299      # beforeunload save
src/app/api/auth/me/route.ts:17-45              # GET /api/auth/me
src/app/api/auth/logout/route.ts:12-36          # POST /api/auth/logout (revoke)
src/proxy.ts:86-135                             # Tenant enforcement (no session logic)
src/lib/store.ts:105-113                        # logout() — очистка клиентского стейта
```

---

## Статусы проверки

| Проверка | Статус | Доказательство |
|----------|--------|----------------|
| Серверный TTL найден | **ПРОЙДЕНО** | `session-service.ts:8` |
| Sliding expiration | **ПРОЙДЕНО** (отсутствует) | Нет кода продления токена при активности |
| Idle timeout (сервер) | **ПРОЙДЕНО** (отсутствует) | Нет `lastActivityAt` в токене/Redis |
| Idle timeout (клиент) | **ПРОЙДЕНО** (отсутствует) | Нет трекера активности в `layout.tsx` / `store.ts` |
| Предупреждение до выхода | **ПРОЙДЕНО** (отсутствует) | Нет модалки/таймера в `api.ts` / `layout.tsx` |
| Черновик отчёта сохраняется | **ПРОЙДЕНО** | `use-report-form.ts:268-343` |
| Черновики других форм | **ПРОЙДЕНО** (отсутствуют) | Поиск по `beforeunload` / `localStorage` — только отчёт и layout-editor |
| Fail-open revocation | **ПРОЙДЕНО** | `session-service.ts:91-140` (комментарии + код) |
| Конфигурация TTL через env | **ПРОЙДЕНО** (отсутствует) | Жестко в коде, env не читается |
| Middleware для сессий | **ПРОЙДЕНО** (отсутствует) | Нет `middleware.ts` в `src/`, только `proxy.ts` (CORS/CSP) |
| Периодический probe клиентом | **ПРОЙДЕНО** (отсутствует) | Нет `setInterval(probeSession)` |
| JWT `exp` доступен клиенту | **ГИПОТЕЗА** | Токен в HttpOnly cookie — JS не читает; нужен отдельный эндпоинт `/api/auth/session-info` с `exp` |

---

## Резюме для владельца (5 строк)

1. Сессия живёт **12 часов жестко**, не настраивается, не продлевается при работе — уйдёшь на обед, вернёшься — всё открыто.
2. **Нет предупреждения** «через 5 минут выйдет» — пользователь узнает об окончании только по ошибке 401 при действии.
3. **Черновик спасается только в отчёте машиниста** (`/operator`); админские формы, наряды, чек-листы — теряются при выходе.
4. Отзыв токена **fail-open**: если Redis упал, отозванный админский вход работает до 12 часов.
5. Чтобы починить: вынести TTL в env, добавить sliding expiration (refresh токена при активности), клиентский таймер до `exp` с модалкой продления, общий хук автосохранения черновиков для всех форм.