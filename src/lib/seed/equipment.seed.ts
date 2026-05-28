import { db } from '@/lib/db';

/**
 * Seed equipment data for development
 */
async function seedEquipment() {
  console.log('🌱 Seeding equipment...');

  const defaultEquipment = [
    {
      id: 'eq-1',
      name: 'Бауман-100',
      model: 'БУ-100',
      qty: 1,
      description: 'Установка для забивки свай с молотом 100 тонн',
    },
    {
      id: 'eq-2',
      name: 'Бауман-80',
      model: 'БУ-80',
      qty: 2,
      description: 'Две установки для бурения лидерных скважин',
    },
    {
      id: 'eq-3',
      name: 'Виброрам РВ-80',
      model: 'РВ-80',
      qty: 1,
      description: 'Вибромолот для устройства свай в грунты',
    },
    {
      id: 'eq-4',
      name: 'Сваебой ненаправленного действия',
      model: 'СНД-04',
      qty: 1,
      description: 'Сваебой с поскоком для забойных работ',
    },
    {
      id: 'eq-5',
      name: 'Дизельный генератор',
      model: 'ГД-500',
      qty: 3,
      description: 'Генератор 500 кВт для питания оборудования',
    },
  ];

  for (const eq of defaultEquipment) {
    try {
      const exists = await db.equipment.findUnique({ where: { id: eq.id } });
      if (exists) {
        console.log(`  ✓ ${eq.name} (already exists)`);
      } else {
        await db.equipment.create({
          data: {
            id: eq.id,
            name: eq.name,
            model: eq.model,
            qty: eq.qty,
            description: eq.description,
            isActive: true,
            tenantId: process.env.DEFAULT_TENANT_ID ?? 'orion',
          },
        });
        console.log(`  ✓ ${eq.name}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to seed ${eq.name}:`, error);
    }
  }

  console.log('✅ Equipment seeding complete');
}

export { seedEquipment };
