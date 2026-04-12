const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const roots = [
  'src',
  'scripts',
  'docs',
  'next.config.ts',
];

const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.json', '.yml', '.yaml']);
const ignoredDirectories = new Set(['node_modules', '.next', 'src/generated']);
const ignoredFiles = new Set(['scripts/check-text-integrity.js']);
const suspiciousPatterns = [
  { label: 'broken-cyrillic-prefix-R', regex: /Р[ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђѓєѕіїјљњћќѝўџ]/u },
  { label: 'broken-cyrillic-prefix-S', regex: /С[ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђѓєѕіїјљњћќѝўџ]/u },
  { label: 'broken-utf8-sequence', regex: /вЂ|в†|Г—/u },
];

function shouldIgnore(fullPath) {
  const normalizedRelativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

  if (ignoredFiles.has(normalizedRelativePath)) {
    return true;
  }

  return [...ignoredDirectories].some((segment) => fullPath.includes(segment));
}

function collectFiles(startPath, results = []) {
  if (!fs.existsSync(startPath)) {
    return results;
  }

  const stat = fs.statSync(startPath);
  if (stat.isFile()) {
    if (allowedExtensions.has(path.extname(startPath)) && !shouldIgnore(startPath)) {
      results.push(startPath);
    }
    return results;
  }

  for (const entry of fs.readdirSync(startPath, { withFileTypes: true })) {
    const fullPath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      if (!shouldIgnore(fullPath)) {
        collectFiles(fullPath, results);
      }
      continue;
    }

    if (allowedExtensions.has(path.extname(fullPath)) && !shouldIgnore(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function findViolations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, index) => {
    for (const pattern of suspiciousPatterns) {
      if (pattern.regex.test(line)) {
        violations.push({
          lineNumber: index + 1,
          label: pattern.label,
          line: line.trim(),
        });
      }
    }
  });

  return violations;
}

const files = roots.flatMap((relativeRoot) => collectFiles(path.join(projectRoot, relativeRoot)));
const violations = files.flatMap((filePath) =>
  findViolations(filePath).map((violation) => ({ filePath, ...violation }))
);

if (!violations.length) {
  console.log('Text integrity check passed.');
  process.exit(0);
}

console.error('Text integrity check failed. Suspicious mojibake fragments found:');
for (const violation of violations) {
  console.error(
    `${path.relative(projectRoot, violation.filePath)}:${violation.lineNumber} [${violation.label}] ${violation.line}`
  );
}

process.exit(1);
