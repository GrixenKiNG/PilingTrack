# Telegram API Proxy via Cloudflare Worker

## Зачем

Российский хостинг блокирует исходящие соединения к `api.telegram.org`.
Этот воркер принимает запросы от прод-сервера и пересылает их к Telegram.
Cloudflare с Telegram нормально общается.

## Развертывание (5 минут)

1. **Регистрация Cloudflare** (бесплатно): https://dash.cloudflare.com/sign-up
2. В дашборде слева → **Workers & Pages** → **Create application** → **Create Worker**
3. Дайте имя, например `pilingtrack-tg-proxy` → **Deploy**
4. **Edit code** → удалите содержимое → вставьте `telegram-proxy.js` → **Save and deploy**
5. Скопируйте URL: `https://pilingtrack-tg-proxy.<your-account>.workers.dev`

## Опциональная защита от чужих запросов

В дашборде воркера → **Settings → Variables** → добавьте `SHARED_SECRET` (любая длинная случайная строка). Тогда сервер должен слать заголовок `X-Proxy-Secret`. (В нынешнем коде приложения этот заголовок не отправляется — пока не используем.)

## Настройка прода

```bash
ssh user@orionpiling.ru
echo 'TELEGRAM_API_BASE=https://pilingtrack-tg-proxy.<your-account>.workers.dev' >> /opt/pilingtrack/.env.production
echo 'TELEGRAM_API_BASE=https://pilingtrack-tg-proxy.<your-account>.workers.dev' >> /opt/pilingtrack/.env

cd /opt/pilingtrack
git pull origin main
docker compose stop app && docker compose rm -f app
docker rmi pilingtrack-app:latest
docker compose build app && docker compose up -d app
```

## Проверка

После рестарта на orionpiling.ru → `/admin/telegram` → «Тест» → должен вернуться 200.

Если не работает:
```bash
docker compose exec app sh -c "echo \$TELEGRAM_API_BASE"
docker compose logs app --since=2m | grep -iE "telegram|error" | tail -20
```

## Лимиты бесплатного плана Cloudflare

- 100 000 запросов в день — для уведомлений по отчётам это **в сотни раз больше необходимого**.
- 10 мс CPU на запрос — прокси использует ~1 мс.
- Если упрётесь — Workers Paid: $5/мес за 10 млн запросов.
