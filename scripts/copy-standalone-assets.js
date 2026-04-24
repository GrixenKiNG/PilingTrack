const fs = require('fs');
const path = require('path');

function copyRecursive(source, target) {
  if (!fs.existsSync(source)) return;

  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function ensureJsStubForTypeFile(typeDir, baseName) {
  const dtsPath = path.join(typeDir, `${baseName}.d.ts`);
  const jsPath = path.join(typeDir, `${baseName}.js`);

  if (!fs.existsSync(dtsPath) || fs.existsSync(jsPath)) {
    return;
  }

  fs.writeFileSync(jsPath, 'export {};\n', 'utf8');
}

const projectRoot = process.cwd();
copyRecursive(
  path.join(projectRoot, '.next', 'static'),
  path.join(projectRoot, '.next', 'standalone', '.next', 'static')
);
copyRecursive(
  path.join(projectRoot, 'public'),
  path.join(projectRoot, '.next', 'standalone', 'public')
);
// Prisma client is imported via a concrete relative path at runtime; Next.js
// does not trace the generated folder into standalone automatically.
copyRecursive(
  path.join(projectRoot, 'src', 'generated', 'postgres-client'),
  path.join(projectRoot, '.next', 'standalone', 'src', 'generated', 'postgres-client')
);
// Release launcher — shipped inside the zip so users can start the server
// without remembering the `node server.js` invocation.
copyRecursive(
  path.join(projectRoot, 'scripts', 'release-start.bat'),
  path.join(projectRoot, '.next', 'standalone', 'start.bat')
);
ensureJsStubForTypeFile(path.join(projectRoot, '.next', 'types'), 'routes');
ensureJsStubForTypeFile(path.join(projectRoot, '.next', 'dev', 'types'), 'routes');
