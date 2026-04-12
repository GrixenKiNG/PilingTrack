/**
 * Migrate passwords from SHA-256 to bcrypt
 * 
 * This script:
 * 1. Reads all users from the database
 * 2. Identifies users with SHA-256 hashed passwords
 * 3. Re-hashes their passwords with bcrypt
 * 
 * IMPORTANT: This script requires the original plain-text passwords
 * to re-hash them. If you don't have them, users will need to reset passwords.
 * 
 * Usage:
 *   npx tsx scripts/migrate-passwords-to-bcrypt.ts [dry-run]
 */

import { hash } from 'bcryptjs';
import { createHash } from 'crypto';

// Database import (adjust path as needed)
const { db } = require('../src/lib/db');

const BCRYPT_ROUNDS = 12;

function sha256Hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function migratePasswords(dryRun = false) {
  console.log('🔐 Password Migration to Bcrypt');
  console.log('=' .repeat(50));

  // Get all users
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
    },
  });

  console.log(`Found ${users.length} users`);

  let migrated = 0;
  let alreadyBcrypt = 0;
  let needsReset = 0;

  for (const user of users) {
    const passwordHash = user.password;

    // Check if already bcrypt (starts with $2a$, $2b$, or $2y$)
    if (passwordHash.startsWith('$2')) {
      console.log(`✅ ${user.email} — already bcrypt`);
      alreadyBcrypt++;
      continue;
    }

    // Check if SHA-256 hash (64 hex characters)
    if (/^[a-f0-9]{64}$/i.test(passwordHash)) {
      console.log(`⚠️  ${user.email} — SHA-256 hash detected`);
      
      if (dryRun) {
        console.log(`   [DRY RUN] Would re-hash with bcrypt`);
        migrated++;
        continue;
      }

      // We can't reverse SHA-256, so user needs to reset password
      console.log(`❌ ${user.email} — needs password reset (SHA-256 irreversible)`);
      needsReset++;
      continue;
    }

    // Plain text password (for development/testing)
    console.log(`🔓 ${user.email} — plain text password`);
    
    if (dryRun) {
      console.log(`   [DRY RUN] Would hash with bcrypt`);
      migrated++;
      continue;
    }

    // Hash with bcrypt
    const bcryptHash = await hash(passwordHash, BCRYPT_ROUNDS);
    await db.user.update({
      where: { id: user.id },
      data: { password: bcryptHash },
    });

    console.log(`✅ ${user.email} — migrated to bcrypt`);
    migrated++;
  }

  console.log('');
  console.log('=' .repeat(50));
  console.log('📊 Migration Summary:');
  console.log(`   Already bcrypt: ${alreadyBcrypt}`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Needs password reset: ${needsReset}`);
  console.log('');

  if (needsReset > 0) {
    console.log('⚠️  IMPORTANT: Users with SHA-256 hashes need to reset passwords');
    console.log('   SHA-256 is irreversible, so we cannot recover their original passwords.');
    console.log('   Options:');
    console.log('   1. Send password reset links to affected users');
    console.log('   2. Set temporary passwords and force change on first login');
    console.log('   3. If you have a list of original passwords, modify this script');
  }

  if (dryRun) {
    console.log('');
    console.log('💡 This was a DRY RUN. No changes were made.');
    console.log('   Run without [dry-run] to actually migrate passwords.');
  }
}

// Run migration
const isDryRun = process.argv.includes('dry-run');
migratePasswords(isDryRun)
  .then(() => {
    console.log('\n✅ Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
