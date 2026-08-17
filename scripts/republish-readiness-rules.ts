/**
 * Переиздание набора правил готовности из умолчаний кода.
 *
 * Зачем. Расчёт готовности читает ОПУБЛИКОВАННЫЙ набор правил тенанта из базы,
 * а не `DEFAULT_READINESS_RULES` из кода. Поэтому смена политики в коде сама по
 * себе ничего не меняет на работающем контуре: у тенанта продолжает
 * действовать набор, опубликованный когда-то раньше. Ловушка сработала
 * 15.08.2026 — наряд-допуск сделали информационным, а он продолжал блокировать
 * смену, потому что в базе лежал набор v1.1 с `PERMIT_EXPIRED = DENY_START`.
 *
 * Скрипт переносит в набор тенанта ДЕЙСТВИЯ И ФЛАГИ блокеров из умолчаний кода.
 * Веса критериев не трогает: их настраивает владелец под себя, и затирать
 * настройку не нужно.
 *
 * Публикация идёт штатным сервисом — с черновиком, архивированием прошлой
 * версии и записью в аудит. Автором изменения будет указанный админ-аккаунт:
 * если авторство должно быть личным, публикуйте через «Настройки → Правила
 * готовности», а не этим скриптом.
 *
 * Запуск:
 *   npx tsx scripts/republish-readiness-rules.ts                 # предпросмотр
 *   npx tsx scripts/republish-readiness-rules.ts --apply
 *   npx tsx scripts/republish-readiness-rules.ts --tenant=orion --apply
 */
import 'dotenv/config';

async function main() {
  const apply = process.argv.includes('--apply');
  const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
  const tenantId = tenantArg || process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new Error('Укажите --tenant=<id> или задайте DEFAULT_TENANT_ID');

  const { db } = await import('../src/lib/db');
  const { DEFAULT_READINESS_RULES } = await import('../src/modules/readiness/domain/readiness-rules');
  const { getReadinessRules, saveReadinessDraft, publishReadinessRules } =
    await import('../src/modules/readiness/application/readiness-rules-service');

  const state = await getReadinessRules(tenantId);
  const current = state.published;

  console.log(`\nТенант: ${tenantId}, действующая версия: ${current.version}\n`);
  let changes = 0;
  for (const target of DEFAULT_READINESS_RULES.blockers) {
    const actual = current.blockers.find((item) => item.condition === target.condition);
    const same = actual && actual.action === target.action && actual.isActive === target.isActive;
    if (same) continue;
    changes += 1;
    const was = actual ? `${actual.action}${actual.isActive ? '' : ' (выключено)'}` : 'правила нет';
    const will = `${target.action}${target.isActive ? '' : ' (выключено)'}`;
    console.log(`  ${target.condition}: ${was}  →  ${will}`);
  }
  if (changes === 0) {
    console.log('  Набор тенанта уже совпадает с умолчаниями кода — публиковать нечего.\n');
    await db.$disconnect();
    return;
  }

  if (!apply) {
    console.log('\nЭто предпросмотр. Записать: добавьте --apply\n');
    await db.$disconnect();
    return;
  }

  const admin = await db.user.findFirst({
    where: { tenantId, role: 'ADMIN', isActive: true },
    select: { id: true, name: true, role: true },
  });
  if (!admin) throw new Error(`У тенанта ${tenantId} нет активного администратора — некому приписать изменение`);

  // Веса критериев берём действующие, блокеры — из кода.
  await saveReadinessDraft(tenantId, { ...current, blockers: DEFAULT_READINESS_RULES.blockers }, admin);
  const published = await publishReadinessRules(tenantId, admin);

  console.log(`\nОпубликовано: версия ${published.published.version}, автор изменения — ${admin.name}.`);
  console.log('Изменение записано в аудит (ReadinessRuleSet / published).\n');
  await db.$disconnect();
}

main().catch((error) => {
  console.error('Переиздание правил оборвано:', error);
  process.exit(1);
});
