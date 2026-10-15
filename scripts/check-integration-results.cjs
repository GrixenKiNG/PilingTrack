const { readFileSync } = require('node:fs');
try {
  const result = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (!result.success || result.numFailedTests !== 0 || result.numPendingTests !== 0 || result.numPassedTests !== result.numTotalTests || result.numTotalTests < 32) {
    throw Error('All integration tests must actually pass: skipped, failed or empty runs are rejected');
  }
  for (const [file, minimum] of [
    ['disposable-rls.spec.ts', 21],
    ['tech-readiness-write-pipeline.spec.ts', 5],
    ['disposable-restore.spec.ts', 3],
  ]) {
    const suite = result.testResults?.find(item => item.name.replaceAll('\\', '/').endsWith('/' + file));
    if (!suite || suite.assertionResults?.length < minimum || !suite.assertionResults?.every(item => item.status === 'passed')) {
      throw Error(`Required integration suite ${file} did not execute all ${minimum} scenarios`);
    }
  }
  console.log(`Integration evidence accepted: ${result.numPassedTests} passed, zero skipped`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
