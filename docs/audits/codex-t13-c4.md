# C4 — HTTP-IDOR и гонка отчётов, 09.10.2026

Ветка `codex/night-1008`, код после C3 `03f5f7ff`. Проверялся собственный одноразовый стенд в `D:/PillingR/wt-codex13`, база `codex_test` на 127.0.0.1, новые контейнеры со штатными метками. Production и `.env` не использовались.

- `bash scripts/test-day-stand.sh`: создание базы и 109 миграций успешно; seed exit 0; вложенный `npm run build` exit 0; приложение READY на `http://127.0.0.1:51975`.
- Через штатный `output/codex-t5/stand-command.json` запущен Node, который передал `CODEX_STAND_URL=BASE_URL` из окружения своего стенда и вызвал `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/disposable-idor.spec.ts tests/integration/disposable-report-race.spec.ts --reporter=verbose`.
- Итог тестового процесса: **exit 0, 160 passed, 0 failed, 0 skipped**, два файла. HTTP-IDOR: **159 passed**; гонка: **1 passed**. В гонке проверены ответы 200/409, версия 2 и сохранение данных победителя. В IDOR проверена сохранность чужих записей после запрещённых мутаций.
- Локальные свидетельства: `output/codex-t5/stand-build.log`, `t13-c4-http.log`, `t13-c4-http-result.json` (`{"exit":0}`). URL базы и случайные пароли не сохраняются в отчёте.

Ограничения: сборка содержит предупреждение BullMQ о необязательном `@valkey/valkey-glide`; пакеты не добавлялись. Отдельный worker лог содержит предупреждение pg о параллельном client.query; работоспособность всех воркеров этим прогоном не доказана. S3 не включён, UI/browser не проверялся. Код продукта C4 не изменялся. Граф GitNexus недоступен (UNKNOWN), результат HTTP не заменяет граф.
