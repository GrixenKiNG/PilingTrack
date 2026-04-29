import 'dotenv/config';
import { telegramNotifier } from '../src/core/notifications/telegram';

(async () => {
  console.log('ENCRYPTION_KEY len:', (process.env.ENCRYPTION_KEY || '').length);
  const test = await telegramNotifier.testConnection();
  console.log('testConnection:', JSON.stringify(test));
  if (!test.ok) process.exit(1);
  const ok = await telegramNotifier.sendMessage(
    '🧪 <b>Тест PilingTrack</b>\nВремя: ' + new Date().toLocaleString('ru-RU'),
  );
  console.log('sendMessage:', ok);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
