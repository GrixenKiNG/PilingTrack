/**
 * Re-encrypt all encrypted DB columns with the currently-active key version.
 *
 * Idempotent: rows already at the active version are left alone (reEncrypt
 * returns the same string unchanged).
 *
 * Add a block here whenever a new encrypted column is introduced.
 */
import 'dotenv/config';
import { db } from '../src/lib/db';
import { isEncrypted, reEncrypt, activeKeyVersion } from '../src/core/security/encryption';

async function main() {
  console.log(`Active encryption key version: ${activeKeyVersion()}`);

  let touched = 0;
  let skipped = 0;

  // ---- TelegramConfig.botToken ----
  const cfgs = await db.telegramConfig.findMany({ select: { id: true, botToken: true } });
  for (const c of cfgs) {
    if (!isEncrypted(c.botToken)) continue;
    const next = reEncrypt(c.botToken);
    if (next === c.botToken) { skipped += 1; continue; }
    await db.telegramConfig.update({ where: { id: c.id }, data: { botToken: next } });
    touched += 1;
  }
  console.log(`TelegramConfig: rotated ${touched}, skipped ${skipped} (already at active version)`);

  // Add future encrypted columns here. Pattern is the same:
  //   1. findMany {select: id, <column>}
  //   2. for each row: skip if !isEncrypted, reEncrypt, write back if changed
  //   3. log counts

  process.exit(0);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
