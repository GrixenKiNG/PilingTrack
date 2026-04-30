import 'dotenv/config';
import { telegramNotifier } from '../src/core/notifications/telegram';

const LAN_URL = 'http://192.168.50.219:3000';

const text = `📱 <b>Установка PilingTrack на iPhone 16 Pro Max</b>

<b>Шаг 1.</b> Подключи iPhone к той же Wi-Fi сети, что и компьютер с dev-сервером.

<b>Шаг 2.</b> Открой Safari на iPhone и перейди по ссылке:
<a href="${LAN_URL}">${LAN_URL}</a>

<b>Шаг 3.</b> Войди логином/PIN.

<b>Шаг 4.</b> Нажми кнопку «Поделиться» (квадрат со стрелкой вверх) → пролистай вниз → <b>«На экран Домой»</b> → «Добавить».

⚠️ <b>Важно:</b>
• Это локальный URL — работает только когда твой dev-сервер запущен и iPhone в той же Wi-Fi.
• Сервер должен слушать <code>0.0.0.0</code> (не <code>localhost</code>). Если по этой ссылке iPhone не открывает, перезапусти dev так:
  <code>npm run dev -- -H 0.0.0.0</code>
• Брандмауэр Windows может блокировать порт 3000 — при первом запуске разреши «частная сеть».
• По HTTP (без HTTPS) приложение добавится как обычный ярлык, без офлайн-режима. Для полноценного PWA нужен HTTPS-туннель (cloudflared / ngrok) — могу настроить отдельно.

⏰ ${new Date().toLocaleString('ru-RU')}`;

(async () => {
  const ok = await telegramNotifier.sendMessage(text);
  console.log('sent:', ok);
  process.exit(ok ? 0 : 1);
})();
