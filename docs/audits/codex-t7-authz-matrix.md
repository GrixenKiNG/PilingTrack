# G3 — матрица прав и атаки на одноразовом E1

Рабочая ветка codex/long-1004, только D:\PillingR\wt-codex7.
Маршруты и методы перечисляются из AST route.ts; ожидания хранятся отдельно
в tests/integration/authz-route-manifest.ts. Новый метод без строки, лишняя
строка и дубликат должны ронять проверку полноты. Ожидания не вычисляются
из проверяемой реализации can() во время теста.

ADMIN и DISPATCHER — платформенные роли. FOREMAN/SAFETY_ENGINEER проверяются
через x-acting-as настоящей ADMIN-сессии; requireAuth разрешает этот заголовок
только администратору и не меняет tenant. Ограничение полномочий следует
из комментария и resolveEffectiveRole в authorization-service, а не из
предположения о запрете платформенным ролям видеть другие организации.
OPERATOR/ASSISTANT проверяются отдельно в своей и чужой организации.

Проверки используют только самостоятельно созданные fixture users,
случайные пароли в памяти, codex-pg и локальный URL. Секреты не записываются
в файлы и не выводятся. Production/server/.env/dependencies не затрагиваются.

## Подтверждение и границы

400 на невалидном запросе не доказывает отказ по правам. Для мутации нужны
валидный положительный контроль и проверка неизменности бизнес-строк после
отказа. Ожидание/fixture, которое пока нельзя проверить, отмечается явно,
а не засчитывается как PASS.

GitNexus launcher с GITNEXUS_INVOCATION=gitnexus возвращает exit1:
CLI gitnexus отсутствует. Риск UNKNOWN, не LOW. Разрешённый THREAD5 fallback:
полный текстовый поиск callers, просмотр live source и scoped git diff.
Пакеты для восстановления CLI не устанавливались.

## Хронология доказательств

Первый E1 S3 запуск exit1: локальный codex-s3-t5:e7 tag отсутствовал.
Его создали из уже имеющегося minio/minio:RELEASE.2024-09-13T20-26-02Z
без pull и установки. Первый stand выполнил own cleanup. Повторный E1:
S3 ready, seed exit0, build exit0, READY http://127.0.0.1:49674.

Первый acting-role RED exit1,3failed/2skipped (pattern selection):
FOREMAN GET /api/user-documents/control вернул200 вместо403. Это
подтверждённая потеря actingAs на передаче actor в service; canonical
users.documents.read_all не разрешён FOREMAN. SAFETY_ENGINEER должен200.
Два POST до проверки прав ADMINpositive вернули400: в fixture не был задан
обязательный expiresAt. Эти два случая пока не являются доказательством
дефекта и требуют исправления fixture и повторного RED.
Логи: output/codex-t5/g3-acting-red.log и g3-acting-red-result.json.

G3 ещё выполняется; общая полнота HTTP, атаки и итоговые counts пока
не подтверждены. G4–G6 не начинались.


## Подтверждённые SECURITY исправления

Валидный acting RED:11failed/2pattern-skipped,exit1. ADMINpositive201
для создания документа,200 для PUT/DELETE и telemetry прошли, затем те же
запросы от ADMIN_AS_FOREMAN/SAFETY_ENGINEER получили201/200 вместо403.
Изменены только3 user-documents routes (сохранён actingAs в actor) и2
telemetry POST guards (resolveEffectiveRole). Actual production rebuild0;
GREEN11passed/2pattern-skipped,exit0,8.00s. afterAll ждёт до12s записи
accepted telemetry controls и проверяет отсутствие всех denied значений
до удаления собственной fixture. Изменения не меняют tenant контекст.
Логи: g3-acting-valid-red и g3-acting-green в output/codex-t5.

Security HTTP RED:120tests,116passed/4failed,exit1,37.80s. Три настоящих
scheme bypass: valid login с другой схемой Origin/Referer и downgrade
Origin при XFP=https выдавал200. Четвёртое падение было ошибкой теста:
retryAfter возвращается в JSON, а не HTTP-header; тест исправлен.
CSRF unit RED9failed/27passed; focused GREEN77passed/0skipped,exit0
(существующие csrf/wrapper/login/logout). Все109 изменяющих API methods
пробуются с6 видами CSRF headers;3 explicit cookie-free endpoints отдельно
проверяются без machine credentials. Logout/password replay, JWT tamper,
account/IP/session/source limits — реальные HTTP, не mocks.

Uploads browser RED:2failed/3passed,exit1,16.1s. Нестрочный fileName дал
500 вместо400; route теперь safeParse unknown→validated.data (string
fileName/contentType/entity ids, finite positive integer size). MIME и
maxsize остаются существующей service policy. Сохранены nullish optional
entity fields. Второе падение — test PDF decoder сначала не понимал
beginbfrange, затем требовал full formula там, где renderer обрезает текст.
Исправлен только decoder/assertion; PDF renderer/XLSX writer не менялись.
Local in-memory PDF repeat0:25466bytes, literalHTML/shortformula present,
activeActions0. Actual HTTP export GREEN отдельно обязателен.
Первые3browserPASS: MIME/size, traversal PNG real PUT→confirm→download,
HTML content422 и actual oversized S3 object413.

## Граница TLS/proxy

Проверяемый режим: app3000/3001 только loopback за Caddy,
TRUST_PROXY=true; Caddy перезаписывает клиентские forwarding headers
(https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults).
В withCsrf доверенный XFP только точно http/https; invalid/multi rejected;
Origin/Referer проверяются по scheme+host+port; headerless script login
сохранён. HTTPS positive реально проверяется browser fixture proxy.

В установленном Next attachRequestMeta формирует Request.url из XFP ещё
до withCsrf. Поэтому unit TRUST_PROXY=false доказывает только поведение
функции на уже сформированном URL, а не независимость схемы HTTP от XFP.
Прямой публичный Next не объявляется защищённым этим тестом. Перед выкладкой
владельцу проверить существующий TRUST_PROXY=true и закрытость app ports;
.env и сервер в задаче не читались/не менялись.

Полная матрица202×9 ещё в работе: inventory уже закреплён, HTTP fixtures и
ручная проверка resource/lifecycle ожиданий ещё не завершены. Ни400, ни
молчаливый skip не объявляются пройденной авторизацией. G4–G6 не начаты.


## Actual GREEN и первый полный matrix run

Actual security GREEN:120passed/0skipped,exit0,30.76s (g3-security-green).
Actual browser GREEN:5passed/0skipped,exit0,19.9s (g3-uploads-green):
malformed filename/entity400, actual PNGroundtrip, MIME/size и HTML/oversize
отказ; PDF literal HTML/shortformula inert + XLSX inlineStr безformula и CSV.
Playwright collection exit0:132tests/13files (было117/12; +5×3projects,
attack writes целенаправленно только Chromium, другие2projects skip).
Tsc перед build0, lint0/0 +textpass, production build на ownenv exit0.
Полный unit первыйrun exit1:3139passed/412skipped/1failed/3552tests/357files,
117.18s. Единственный отказ — существующий unified-worker health cold import
30s timeout. Worker код не менялся; targeted повтор без изменения таймаута
exit0:11passed/0skipped,4.03s. Полный unit пока НЕ объявляется GREEN.

Первая actual fullmatrix:exit1,1626passed/35failed/171skipped/1832tests,
65.84s. 160allow lifecycle cells ещё PENDING;11acting regressions пропущены
из-за suite-level fixture ошибки (разбор ниже обязан уточнить причину).
Есть true valid RED layout PUT/DELETE, monitoring/template PUT, settings PUT
для2acting roles: 200 вместо403. Guards исправлены на effectiveRole (+7/-4
в3routes); data/visual/layout services не менялись. Other failures ещё
разбираются как fixtures/expectations; не все35 считаются security bugs.

## Повторная проверка G3 (04.10)

Второй полный matrix run: exit 1, 1697 passed / 2 failed / 133 skipped,
1832 tests, 74.14s. Восемь acting guards и 11 ранних regressions прошли.
Два падения admin-upsert: собственному новому Site недоставало назначения
оператора. Cleanup отдельно встретил immutable ReadinessScoreSnapshot;
эти снимки и зависимые записи сохраняются до удаления собственного PG,
обход триггеров запрещён. 133 положительных сценария ещё не завершены.

После свежего production build: g3-attacks-final exit 0, 126 passed /
0 skipped, 30.02s. Дополнительные шесть Feedback RED стали GREEN:
acknowledge запрещён действующим ролям, audience принудительно USER,
private USER event не виден при переключении с тёплого ADMIN cache.
Meter RED: настоящее HTTP201 при попытке Инженера ОТ уменьшить 200→199;
исправление применяет effectiveRole. Unit RED 1→GREEN 6/6, actual browser
GREEN: g3-browser-final exit 0, 6 passed / 0 skipped, 44.4s.

CSRF enumeration переведён с regex на общий AST inventory (109 mutations;
до замены списки совпадали). Таким образом named reexports тоже попадают
в проверку. Повтор этого теста на новом стенде ещё требуется.

Новый стенд использует e2e/fixtures/disposable-telegram-transport.mjs:
локальный loopback HTTP transport getChat/sendMessage/sendDocument;
токены и тела не сохраняются, внешние сообщения не отправляются.
Production notifier не заменяется. Это доказательство прикладного
контракта с собственным HTTP сервером, а не доступности Telegram.

Read-only review субагента: focused existing unit suite exit 0,
120 passed / 0 skipped, 7 files, 3.86s (CSRF, api-wrapper, feedback,
user-documents, meter, media content/extension). Отдельного logfile у
этого запуска нет; результат зафиксирован в tool stdout.
Media signature tests не доказывают полное декодирование каждого
поддерживаемого формата. Настоящий S3 PNG roundtrip проверен браузером.