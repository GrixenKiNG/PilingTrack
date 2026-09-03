/**
 * Справочник видов документов работника — наполнение по перечню из
 * спецификации модуля «Оператор» (раздел 5).
 *
 * ЗАЧЕМ. Механизм допуска построен и работает: `evaluateOperatorClearance`
 * останавливает смену без документа и предупреждает об истекающем. Но
 * справочник видов содержал четыре позиции, а документов не было заведено ни
 * одного — первые ворота не проверяли ничего. Заполнить перечень нужно до
 * того, как заводить сами документы: без вида документ создать нельзя.
 *
 * ПОЧЕМУ СКРИПТ, А НЕ РУКАМИ. Тот же перечень понадобится на бою, и вводить
 * одиннадцать позиций дважды — верный способ разойтись в названиях. Здесь же
 * записаны и сроки действия, которые иначе пришлось бы помнить.
 *
 * БЕЗОПАСНОСТЬ. Скрипт только добавляет. Существующие виды не трогает вовсе —
 * ни названий, ни сроков, ни флага обязательности. `requiredForOperator` у
 * новых видов остаётся ВЫКЛЮЧЕННЫМ: включение хотя бы одного вида без
 * загруженных документов немедленно остановит всех операторов, у кого его нет.
 * Поэтому включать обязательность — отдельное решение владельца, после того
 * как документы заведены.
 *
 * Запуск: npx tsx scripts/seed-user-document-types.ts            (показать план)
 *         npx tsx scripts/seed-user-document-types.ts --apply    (записать)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/postgres-client';

interface DocumentTypeSeed {
  name: string;
  /** Срок действия по умолчанию, месяцев. null — бессрочный. */
  defaultValidMonths: number | null;
  /** За сколько дней до конца срока предупреждать. */
  leadTimeDays: number;
  notes: string;
}

/**
 * Перечень из раздела 5 спецификации. Сроки — принятые по умолчанию, их
 * положено сверить с инструкциями изготовителя и требованиями охраны труда:
 * спецификация прямо требует держать нормы настраиваемыми, а не в коде.
 * Здесь они лишь заполняют поле «по умолчанию» в форме заведения документа —
 * фактическая дата окончания всегда берётся из самого документа.
 */
const CATALOGUE: DocumentTypeSeed[] = [
  {
    name: 'Пожарно-технический минимум',
    defaultValidMonths: 36,
    leadTimeDays: 30,
    notes: 'Обучение мерам пожарной безопасности.',
  },
  {
    name: 'Электробезопасность (группа допуска)',
    defaultValidMonths: 12,
    leadTimeDays: 30,
    notes: 'Группа по электробезопасности с ежегодной проверкой знаний.',
  },
  {
    name: 'Первая помощь пострадавшим',
    defaultValidMonths: 36,
    leadTimeDays: 30,
    notes: 'Обучение приёмам оказания первой помощи.',
  },
  {
    name: 'Стропальные работы',
    defaultValidMonths: 12,
    leadTimeDays: 30,
    notes: 'Удостоверение стропальщика; проверка знаний ежегодно.',
  },
  {
    name: 'Управление грузоподъёмными механизмами',
    defaultValidMonths: 12,
    leadTimeDays: 30,
    notes: 'Допуск к работам с грузоподъёмными механизмами.',
  },
  {
    name: 'Допуск к работам вблизи ЛЭП',
    defaultValidMonths: 12,
    leadTimeDays: 30,
    notes: 'Требуется при работе в охранной зоне линий электропередачи.',
  },
  {
    // Окно предупреждения короче остальных намеренно: цикл повторного
    // инструктажа — квартал, и предупреждение за 30 дней горело бы треть срока.
    name: 'Повторный инструктаж по охране труда',
    defaultValidMonths: 3,
    leadTimeDays: 7,
    notes: 'Периодический инструктаж на рабочем месте.',
  },
];

/** Та же нормализация, что в `user-documents.ts`: сверка идёт по ней. */
const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');

const connectionString = process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('DATABASE_URL_POSTGRES is required');

const apply = process.argv.includes('--apply');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new Error('DEFAULT_TENANT_ID is required');

  const existing = await db.userDocumentType.findMany({
    where: { tenantId },
    select: { name: true, normalizedName: true, requiredForOperator: true },
  });
  const known = new Set(existing.map((type) => type.normalizedName));
  const toCreate = CATALOGUE.filter((seed) => !known.has(normalize(seed.name)));

  console.log(`База: ${new URL(connectionString!).pathname.replace(/^\//, '')} · организация: ${tenantId}`);
  console.log(`\nУже в справочнике (${existing.length}):`);
  for (const type of existing) {
    console.log(`  · ${type.name}${type.requiredForOperator ? '  [обязателен]' : ''}`);
  }

  if (toCreate.length === 0) {
    console.log('\nДобавлять нечего — весь перечень уже заведён.');
    return;
  }

  console.log(`\nБудет добавлено (${toCreate.length}), все — НЕ обязательные:`);
  for (const seed of toCreate) {
    console.log(`  + ${seed.name} · срок ${seed.defaultValidMonths} мес · предупреждать за ${seed.leadTimeDays} дн.`);
  }

  if (!apply) {
    console.log('\nЭто предварительный показ. Чтобы записать, повторите с --apply');
    return;
  }

  await db.userDocumentType.createMany({
    data: toCreate.map((seed) => ({
      tenantId,
      name: seed.name,
      normalizedName: normalize(seed.name),
      requiresExpiry: true,
      defaultValidMonths: seed.defaultValidMonths,
      leadTimeDays: seed.leadTimeDays,
      requiredForOperator: false,
      notes: seed.notes,
    })),
  });
  console.log(`\nГотово: добавлено ${toCreate.length}. Обязательность не включена ни у одного вида.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
