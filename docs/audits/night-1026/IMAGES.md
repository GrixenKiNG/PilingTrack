# Docker-образы main и локальный smoke

Задача 4 выполнена для **origin/main efd95008eac3bc846c89003c4b7766f2eb5c1c9b**, не для ветки ночных исправлений. main повторно проверен перед сборкой. Никаких push, SSH, передачи образов или выкладки.

Перед сборкой: D: свободно 160 909 754 368 байт (~150 GiB); .wslconfig: memory=8GB, swap=4GB, autoMemoryReclaim=dropcache. Конфигурация только прочитана. Контекст `D:/PillingR/night-logs/night-evidence-1026/images-source` получен git archive этого SHA с исключением всех .env* по именам; содержимое env-файлов не читалось и не экспортировалось. В контексте нет node_modules/generated/junctions.

| Команда | Exit | Время |
|---|---:|---:|
|docker build -f images-source/Dockerfile --target runner --build-arg APP_VERSION=efd95008 -t codex-night-evidence-app:efd95008 images-source|0|360 с|
|docker build -f images-source/Dockerfile.workers --target runner -t codex-night-evidence-workers:efd95008 images-source|0|43 с|
|bash images-source/scripts/smoke-workers-image.sh codex-night-evidence-workers:efd95008|0|9 с|
|Реальный совместный запуск app/workers на одноразовых PG18/Redis/MinIO|0|145 с с подготовкой/ожиданием/уборкой|
|npm run prod:smoke -- --url http://127.0.0.1:53354 --sha efd95008|0|2 с, 13/13|

Сборки и проверки выполнялись последовательно. Dockerfile использовал собственные штатные build-time значения; runtime получил только реальные значения собственных сгенерированных фикстур через память процессов. Файлов .env не создавалось.

Образ app: `sha256:0eba6c9302b78b7f40f3240362ac0f81bbf38fe62ca6d4f17693a0e6fed7a024`, размер 476 428 404 байт.
Образ workers: `sha256:47124c65fc8d417eec764e3683ee54b01c39a72d4c6c0512bb2bf76a3d4f5642`, размер 1 149 960 367 байт.

Workers smoke из runbook 008: настоящая загрузка runner с закрытой сетью, есть Unified Worker Service starting и Arming; отсутствуют ошибки MODULE_NOT_FOUND/SyntaxError/ReferenceError. Совместный запуск отдельно подтвердил соединения с собственной PostgreSQL/Redis и heartbeat планировщиков.

`prod:smoke` запущен с явным localhost (его production-адрес по умолчанию не использовался): health.version=efd95008, deep database/redis/schedulers/storage=ok, главная и login=200, три закрытых API без сессии=401. Планировщикам дано дождаться штатного startup delay 60/90 с, готовность не имитировалась.

## Исходная красная попытка стенда

Первый runtime-wrapper exit 1, 70 с: Docker internal network не выдала публикацию порта 3000. До prod:smoke он не дошёл, checks пусты. Это ошибка конфигурации внешнего проверочного стенда, не подтверждённый дефект образа. Собственные ресурсы убраны, результат сохранён в image-runtime-internal-network-*. Следующий запуск создал отдельную bridge-сеть с публикацией только на 127.0.0.1, без правок приложения/образов.

## Уборка и ограничения

Совместный smoke удалил только созданные им app/workers, два Redis, PG18 и сеть; собственный MinIO отключён от временной сети. cleanup=true, cleanupErrors=[]. Образы оставлены для приёмки. Рабочие контейнеры/данные не трогались. Глобальные prune не запускались.

Docker выдал три предупреждения SecretsUsedInArgOrEnv для штатных build-time заглушек Dockerfile. Они не являются результатом чтения credentials и не скрыты из лога. При первом старте на пустой БД лог сообщает об отсутствующем DEFAULT_TENANT_ID; собственно публичный smoke прошёл, но он не доказывает tenant-зависимые Telegram/ORION/monitoring-процессы. Production-конфигурация не проверялась.

Это доказательство упаковки и запуска main. Образы не содержат четыре исправления ночной ветки и не объявляются готовым релизом этой ветки.

Сырые команды, exit, время, health, логи и cleanup: `D:/PillingR/night-logs/night-evidence-1026/image-*`.
