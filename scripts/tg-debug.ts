import 'dotenv/config';
import { db } from '../src/lib/db';
import { decrypt, isEncrypted } from '../src/core/security/encryption';

(async () => {
  const cfg = await db.telegramConfig.findFirst({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
  if (!cfg) { console.log('No config'); process.exit(0); }
  console.log('chatId:', cfg.chatId);
  console.log('botToken raw len:', cfg.botToken.length, 'isEncrypted:', isEncrypted(cfg.botToken));
  try {
    const tok = isEncrypted(cfg.botToken) ? decrypt(cfg.botToken) : cfg.botToken;
    console.log('decrypted token len:', tok.length);
    console.log('decrypted token first 6:', tok.slice(0, 6));
    console.log('decrypted token last 4:', tok.slice(-4));
    const looksValid = /^\d+:[A-Za-z0-9_-]+$/.test(tok);
    console.log('matches bot token regex:', looksValid);

    // direct ping
    const r = await fetch(`https://api.telegram.org/bot${tok}/getMe`);
    console.log('getMe status:', r.status);
    console.log('getMe body:', (await r.text()).slice(0, 200));
  } catch (e) {
    console.error('decrypt failed:', e);
  }
  process.exit(0);
})();
