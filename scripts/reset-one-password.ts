/**
 * Разовый сброс пароля ОДНОМУ пользователю на локальной базе.
 *
 * Отличие от `reset-passwords.ts`: тот переписывает пароли всему списку разом.
 * Здесь — ровно один адрес, чтобы не трогать учётки, вход в которые сейчас
 * работает.
 *
 * Предохранитель обязателен: скрипт переписывает пароль, и запуск его по
 * production-строке подключения был бы прямой дырой. Проверяем и хост, и имя
 * базы — одного мало: локальный туннель на прод выглядит как localhost.
 *
 * Запуск: npx tsx scripts/reset-one-password.ts <email> <password>
 */
import { PrismaClient } from '../src/generated/postgres-client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashSync } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('DATABASE_URL_POSTGRES is required');

const url = new URL(connectionString);
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
const isTestDatabase = url.pathname.replace(/^\//, '').startsWith('pilingtrack_test');
if (!isLocalHost || !isTestDatabase) {
  throw new Error(
    `Отказано: скрипт работает только с локальной pilingtrack_test (получено ${url.hostname}${url.pathname})`,
  );
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  throw new Error('Usage: npx tsx scripts/reset-one-password.ts <email> <password>');
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const updated = await db.user.updateMany({
    where: { email },
    // 12 раундов — как в остальном приложении; меньше нельзя, иначе локальные
    // хэши перестанут соответствовать тому, что проверяет вход.
    data: { password: hashSync(password, 12) },
  });
  if (updated.count === 0) throw new Error(`Пользователь ${email} не найден`);
  console.log(`Пароль обновлён: ${email} (записей: ${updated.count})`);
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
