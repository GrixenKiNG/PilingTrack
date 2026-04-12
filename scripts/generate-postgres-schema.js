const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const sqliteSchemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
const postgresSchemaPath = path.join(projectRoot, 'prisma', 'schema.postgres.prisma');

const sqliteSchema = fs.readFileSync(sqliteSchemaPath, 'utf8');
let postgresSchema = sqliteSchema
  .replace(
    /generator client\s*{[\s\S]*?provider\s*=\s*"prisma-client-js"[\s\S]*?}/m,
    'generator client {\n  provider = "prisma-client-js"\n  output   = "../src/generated/postgres-client"\n}'
  )
  .replace(
  /datasource db\s*{([\s\S]*?)provider\s*=\s*"sqlite"/m,
  'datasource db {$1provider = "postgresql"'
  )
  .replace('env("DATABASE_URL")', 'env("DATABASE_URL_POSTGRES")');

let mediaModelSeen = false;
postgresSchema = postgresSchema.replace(/model Media \{[\s\S]*?\n\}/g, (match) => {
  if (mediaModelSeen) {
    return '';
  }
  mediaModelSeen = true;
  return match;
});

fs.writeFileSync(postgresSchemaPath, postgresSchema, 'utf8');
console.log(`Generated ${path.relative(projectRoot, postgresSchemaPath)}`);
