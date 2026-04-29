import { telegramNotifier } from '@/core/notifications/telegram';

(async () => {
  const t = await telegramNotifier.testConnection();
  console.log('testConnection:', JSON.stringify(t));
  if (!t.ok) process.exit(1);

  const ok = await telegramNotifier.sendMessage(
    '🧪 <b>Тестовое сообщение PilingTrack</b>\nПроверка связи бота с чатом — всё работает ✅',
  );
  console.log('sendMessage ok:', ok);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR:', e); process.exit(1); });
