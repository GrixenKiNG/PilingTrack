/** Public entry points are the documented module API; internal paths stay private. */
export function isPublicModuleEntry(importPath: string): boolean {
  return /^@\/modules\/[a-z0-9-]+(?:\/server)?$/.test(importPath);
}
export function isModuleServerEntry(importPath: string): boolean {
  return /^@\/modules\/[a-z0-9-]+\/server$/.test(importPath);
}
