const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const clientIndexPath = path.join(projectRoot, 'src', 'generated', 'postgres-client', 'index.js');
const runtimeLibraryPath = path.join(
  projectRoot,
  'src',
  'generated',
  'postgres-client',
  'runtime',
  'library.js'
);

if (!fs.existsSync(clientIndexPath)) {
  console.log('Postgres client index.js not found, skipping patch.');
  process.exit(0);
}

let source = fs.readFileSync(clientIndexPath, 'utf8');

source = source.replace(
  /const fs = require\('fs'\)\s*\n\s*\nconfig\.dirname = __dirname\s*\nif \(!fs\.existsSync\(path\.join\(__dirname, 'schema\.prisma'\)\)\) \{[\s\S]*?config\.isBundled = true\s*\n\}/m,
  "config.dirname = __dirname\nconfig.isBundled = true"
);

source = source.replace(
  /\npath\.join\(process\.cwd\(\), "src\/generated\/postgres-client\/query_engine-windows\.dll\.node"\)/g,
  ''
);

source = source.replace(
  /\npath\.join\(process\.cwd\(\), "src\/generated\/postgres-client\/schema\.prisma"\)/g,
  ''
);

source = source.replace(
  /"relativeEnvPaths":\s*\{\s*"rootEnvPath":\s*null,\s*"schemaEnvPath":\s*"[^"]+"\s*\}/m,
  `"relativeEnvPaths": {\n    "rootEnvPath": null,\n    "schemaEnvPath": null\n  }`
);

source = source.replace(
  /\nconst \{ warnEnvConflicts \} = require\('\.\/runtime\/library\.js'\)\s*\n\s*\nwarnEnvConflicts\(\{\s*rootEnvPath:[\s\S]*?schemaEnvPath:[\s\S]*?\}\)\s*/m,
  '\n'
);

fs.writeFileSync(clientIndexPath, source, 'utf8');

if (fs.existsSync(runtimeLibraryPath)) {
  let runtimeSource = fs.readFileSync(runtimeLibraryPath, 'utf8');

  runtimeSource = runtimeSource.replace(
    /process\.cwd\(\)/g,
    '/*turbopackIgnore: true*/ process.cwd()'
  );

  fs.writeFileSync(runtimeLibraryPath, runtimeSource, 'utf8');
}

console.log('Patched generated Postgres Prisma client for standalone-friendly tracing.');
