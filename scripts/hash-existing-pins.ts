/**
 * Migrate plain-text PINs to bcrypt hashes.
 *
 * Usage:
 *   npx tsx scripts/hash-existing-pins.ts
 *
 * This script:
 * 1. Connects to the database
 * 2. Finds all users with non-hashed PINs
 * 3. Hashes them with bcrypt (12 rounds)
 * 4. Updates the database
 */

import { PrismaClient } from '@prisma/client';
import { hash as bcryptHash } from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

async function main() {
  const db = new PrismaClient();

  try {
    console.log('🔍 Scanning for plain-text PINs...');

    const users = await db.user.findMany({
      where: {
        pin: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
        pin: true,
      },
    });

    const plainTextPins = users.filter(
      (u: { pin: string | null }) => u.pin && !u.pin.startsWith('$2')
    );

    if (plainTextPins.length === 0) {
      console.log('✅ All PINs are already hashed. Nothing to do.');
      return;
    }

    console.log(`📋 Found ${plainTextPins.length} user(s) with plain-text PINs:`);
    plainTextPins.forEach((u: { email: string; name: string; pin: string | null }) => {
      console.log(`   - ${u.email} (${u.name}) — PIN: ${u.pin}`);
    });

    console.log('\n🔐 Hashing PINs with bcrypt...');

    let hashed = 0;
    let failed = 0;

    for (const user of plainTextPins) {
      try {
        const hashedPin = await bcryptHash(user.pin!, BCRYPT_ROUNDS);
        await db.user.update({
          where: { id: user.id },
          data: { pin: hashedPin },
        });
        console.log(`   ✅ ${user.email} → hashed`);
        hashed++;
      } catch (err) {
        console.error(`   ❌ ${user.email} — failed: ${(err as Error).message}`);
        failed++;
      }
    }

    console.log(`\n📊 Results: ${hashed} hashed, ${failed} failed`);

    if (failed > 0) {
      console.error('\n⚠️  Some PINs failed to hash. Run the script again to retry.');
      process.exitCode = 1;
    } else {
      console.log('\n✅ All PINs successfully hashed!');
    }
  } catch (err) {
    console.error('💥 Migration failed:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main();
