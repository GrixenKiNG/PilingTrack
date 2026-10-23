import { defineConfig } from '@playwright/test';
import original from './playwright.config';

// Passwords and account matrix come from disposable-qa.mjs, never external files.
export default defineConfig({
  ...original,
  testMatch: ['qa/**/*.spec.ts', 'qa-ac/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalTimeout: 90 * 60_000,
  outputDir: 'output/qa-stabilize-1023/artifacts',
  reporter: [['line'], ['json', { outputFile: 'output/qa-stabilize-1023/qa-195-results.json' }]],
  use: { ...original.use, trace: 'retain-on-failure', video: 'off' },
  projects: original.projects?.filter((project) => project.name !== 'unauthenticated'),
});
