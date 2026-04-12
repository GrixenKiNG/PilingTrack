import { existsSync } from 'fs';
import { join } from 'path';

export function resolveRuntimeScript(scriptName: string) {
  const candidates = [
    join(process.cwd(), 'scripts', scriptName),
    join(process.cwd(), '.next', 'standalone', 'scripts', scriptName),
    join(process.cwd(), '..', 'scripts', scriptName),
    join(process.cwd(), '..', '.next', 'standalone', 'scripts', scriptName),
    join(process.cwd(), '..', '..', 'scripts', scriptName),
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Runtime script not found: ${scriptName}`);
  }

  return resolved;
}
