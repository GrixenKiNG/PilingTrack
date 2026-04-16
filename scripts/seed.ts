#!/usr/bin/env node
/**
 * Database Seed Script
 * 
 * Usage:
 *   npx ts-node scripts/seed.ts
 *   NODE_ENV=development npm run seed
 */

import { seedEquipment } from '@/lib/seed/equipment.seed';

async function main() {
  console.log('🌱 Starting database seed...');
  console.log('');

  try {
    await seedEquipment();
    console.log('');
    console.log('✅ Seed complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

main();
