/**
 * Migrate plain-text Telegram bot tokens to encrypted format.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-bot-tokens.ts
 *
 * This script:
 * 1. Connects to the database
 * 2. Finds all TelegramConfig with unencrypted botToken
 * 3. Encrypts them with AES-256-GCM
 * 4. Updates the database with 'enc:' prefix
 */

import { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted } from '@/core/security/encryption';

async function main() {
  const db = new PrismaClient();

  try {
    console.log('🔍 Scanning for unencrypted Telegram bot tokens...\n');

    const configs = await db.telegramConfig.findMany({
      select: { id: true, botToken: true, label: true },
    });

    const unencrypted = configs.filter(
      (c: { botToken: string | null; label: string | null }) => c.botToken && !isEncrypted(c.botToken)
    );

    if (unencrypted.length === 0) {
      console.log('✅ All bot tokens are already encrypted. Nothing to do.\n');
      return;
    }

    console.log(`📋 Found ${unencrypted.length} config(s) with plain-text bot tokens:`);
    unencrypted.forEach((c: { botToken: string | null; label: string | null; id: string }) => {
      const masked = c.botToken!.slice(0, 10) + '...';
      console.log(`   - ${c.label || c.id} — token: ${masked}`);
    });

    console.log('\n🔐 Encrypting bot tokens with AES-256-GCM...\n');

    let encrypted = 0;
    let failed = 0;

    for (const config of unencrypted) {
      try {
        const encryptedToken = encrypt(config.botToken!);
        await db.telegramConfig.update({
          where: { id: config.id },
          data: { botToken: encryptedToken },
        });
        console.log(`   ✅ ${config.label || config.id} → encrypted`);
        encrypted++;
      } catch (err) {
        console.error(
          `   ❌ ${config.label || config.id} — failed: ${(err as Error).message}`
        );
        failed++;
      }
    }

    console.log(`\n📊 Results: ${encrypted} encrypted, ${failed} failed`);

    if (failed > 0) {
      console.error('\n⚠️  Some tokens failed to encrypt. Run the script again to retry.\n');
      process.exitCode = 1;
    } else {
      console.log('\n✅ All bot tokens successfully encrypted!\n');
    }
  } catch (err) {
    console.error('💥 Migration failed:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main();
