import { defineConfig, env } from 'prisma/config';

// Disposable tests must not load the repository's .env or production config.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('INTEGRATION_DATABASE_URL_OWNER') },
});
