/**
 * Main Entry Point — PilingTrack Multi-Agent Testing System
 * 
 * Запуск: npm run agents:test
 * Или: npx tsx agents/run-agents.ts
 */

import { runQADirector, FinalReport } from './qa-director';
import * as path from 'path';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   PILINGTRACK MULTI-AGENT TESTING SYSTEM v1.0.0        ║');
  console.log('║   25 AI Agents для тестирования industrial SaaS         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  const projectRoot = path.join(__dirname, '..');

  try {
    const report = await runQADirector(projectRoot);
    
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║              FINAL REPORT SUMMARY                        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Агентов выполнено: ${report.agentsExecuted}/${report.totalAgents}`);
    console.log(`✅ Passed: ${report.agentsPassed}`);
    console.log(`❌ Failed: ${report.agentsFailed}`);
    console.log(`⚠️  Warning: ${report.agentsWarning}`);
    console.log(`⏭️  Skipped: ${report.agentsSkipped}`);
    console.log('');
    
    const totalFindings = Object.values(report.findings).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`Всего находок: ${totalFindings}`);
    console.log(`  🔴 Critical: ${report.findings.critical.length}`);
    console.log(`  🟠 High: ${report.findings.high.length}`);
    console.log(`  🟡 Medium: ${report.findings.medium.length}`);
    console.log(`  🟢 Low: ${report.findings.low.length}`);
    console.log(`  ℹ️  Info: ${report.findings.info.length}`);
    console.log('');

    if (report.recommendations.length > 0) {
      console.log('TOP 10 RECOMMENDATIONS:');
      console.log('─'.repeat(60));
      report.recommendations.slice(0, 10).forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}`);
      });
      console.log('');
    }

    // Exit с кодом если есть critical
    const hasCritical = report.findings.critical.length > 0;
    if (hasCritical) {
      console.log('⚠️  Обнаружены критические проблемы! Требуется немедленное исправление.');
      process.exit(1);
    } else {
      console.log('✅ Критических проблем не обнаружено.');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Ошибка при запуске тестирования:');
    console.error(error);
    process.exit(1);
  }
}

main();
