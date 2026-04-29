import { telegramNotifier } from '@/core/notifications/telegram';
import { loadSingleReportPdfContext } from '@/lib/pdf-data';
import { generateSinglePdf } from '@/lib/pdf-generator';

(async () => {
  const ctx = await loadSingleReportPdfContext('755f2ca2-1d0b-4c4a-8b26-6f117953dcb9');
  if (!ctx) { console.log('NO CTX'); process.exit(1); }
  console.log('Got ctx, generating PDF...');
  const pdfBuffer = await generateSinglePdf(ctx.pdfData);
  console.log('PDF generated, size:', pdfBuffer.length);
  const ok = await telegramNotifier.sendDocument('test.pdf', pdfBuffer, '🧪 manual handler test');
  console.log('sendDocument ok:', ok);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR:', e?.message || e); process.exit(1); });
