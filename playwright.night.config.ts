import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Own disposable fixtures only. The legacy qa/ suites load external credentials
// and are deliberately not collected by this configuration.
const specs = [
  'admin-dictionaries.spec.ts', 'admin-users.spec.ts', 'app.spec.ts',
  'inspection-to-flow.spec.ts', 'monitoring-tile-editor.spec.ts',
  'operator-report-smoke.spec.ts', 'rate-limit-e2e.spec.ts',
  'release-critical-path.spec.ts', 'report-creation-flow.spec.ts',
  'smoke-e2e.spec.ts', 'role-audit.spec.js', 'night-role-walkthrough.spec.ts',
];

export default defineConfig({
  ...base,
  testMatch: specs.map(name => '**/' + name),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.NIGHT_REPORT || 'output/night-1026/playwright.json' }],
  ],
  outputDir: 'output/night-1026/browser',
  use: { ...base.use, trace: 'off', video: 'off' },
});
