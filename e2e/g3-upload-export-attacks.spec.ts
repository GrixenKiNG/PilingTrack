import { test as base, expect } from './fixtures/disposable.fixture';
import { TEST_USERS } from './fixtures/auth.fixture';
import { login } from './page-objects/login.page';
import { createSecurityExportFixture, HTML_ATTACK, FORMULA_ATTACKS } from './fixtures/disposable-security-export-seed.mjs';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { inflateRawSync, inflateSync } from 'node:zlib';

type Fixture = Awaited<ReturnType<typeof createSecurityExportFixture>>;
const test = base.extend<{ attackFixture: Fixture }>({
  attackFixture: async ({}, applyFixture) => {
    const fixture = await createSecurityExportFixture();
    try { await applyFixture(fixture); } finally { await fixture.cleanup(); }
  },
});
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Security writes run once on the owned E1 stand');
  await login(page, TEST_USERS.admin.email, TEST_USERS.admin.password);
});

function s3Fixture() {
  const endpoint = new URL(process.env.S3_ENDPOINT || 'http://invalid');
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'https:' || process.env.S3_BUCKET !== 'codex-photos' || !process.env.S3_ACCESS_KEY_ID?.startsWith('codex')) throw Error('Owned HTTPS S3 required');
  return new S3Client({ endpoint: endpoint.origin, region: process.env.S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } });
}

// Read the actual response archive, rather than mocking the spreadsheet writer.
function zipXml(bytes: Buffer): string[] {
  const xml: string[] = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    const data = bytes.subarray(start, start + size);
    if (name.endsWith('.xml') || name.endsWith('.rels')) xml.push((method === 8 ? inflateRawSync(data) : data).toString());
    offset = start + size;
  }
  expect(xml.length).toBeGreaterThan(5);
  return xml;
}

// PDFKit emits Type0 fonts with a ToUnicode map. Decode those exact glyphs to
// prove the attack was present as text, not simply absent from an empty PDF.
function pdfEvidence(bytes: Buffer) {
  const objects = new Map<number, string>();
  for (const match of bytes.toString('latin1').matchAll(/(\d+) 0 obj\b([\s\S]*?)endobj/g)) objects.set(Number(match[1]), match[2]);
  const streams = new Map<number, string>();
  for (const [id, object] of objects) {
    const stream = object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (stream) streams.set(id, (/\/FlateDecode/.test(object) ? inflateSync(Buffer.from(stream[1], 'latin1')) : Buffer.from(stream[1], 'latin1')).toString('latin1'));
  }
  const fonts = new Map<number, Map<string, string>>();
  for (const [id, object] of objects) {
    const reference = object.match(/\/ToUnicode (\d+) 0 R/);
    if (!reference) continue;
    const map = new Map<string, string>();
    const cmap = streams.get(Number(reference[1])) || '';
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) {
        const unicode = Buffer.from(pair[2], 'hex');
        map.set(pair[1].toLowerCase(), unicode.swap16().toString('utf16le'));
      }
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1].matchAll(/<([a-f\d]+)>\s*<[a-f\d]+>\s*\[([^\]]+)\]/gi)) {
        let glyph = parseInt(range[1], 16);
        for (const entry of range[2].matchAll(/<([a-f\d ]+)>/gi)) {
          const unicode = Buffer.from(entry[1].replace(/ /g, ''), 'hex');
          map.set((glyph++).toString(16).padStart(4, '0'), unicode.swap16().toString('utf16le'));
        }
      }
    }
    fonts.set(id, map);
  }
  const aliases = new Map<string, Map<string, string>>();
  for (const object of objects.values()) for (const reference of object.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const map = fonts.get(Number(reference[2]));
    if (map) aliases.set(reference[1], map);
  }
  let text = '';
  for (const stream of streams.values()) {
    let font: Map<string, string> | undefined;
    for (const token of stream.matchAll(/\/(F\d+) [\d.]+ Tf|<([a-f\d]+)>/gi)) {
      if (token[1]) font = aliases.get(token[1]);
      else if (font) for (let index = 0; index < token[2].length; index += 4) text += font.get(token[2].slice(index, index + 4).toLowerCase()) || '';
    }
  }
  return { text: text.replace(/\s/g, ''), structure: [...objects.values(), ...streams.values()].join('\n') };
}

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1EAAAAASUVORK5CYII=', 'base64');
const descriptor = (reportId: string) => ({ fileName: 'codex-g3.png', contentType: 'image/png', fileSize: tinyPng.length, entityType: 'report', entityId: reportId });

test('G3 malformed upload descriptors fail with 400, not 500', async ({ page, attackFixture }) => {
  const origin = new URL(page.url()).origin;
  const malformed = [
    ...[{ nested: 'file.png' }, ['file.png'], 7, true].map(fileName => ({ fileName })),
    { entityType: { nested: 'report' } }, { entityId: ['report'] },
  ];
  for (const fields of malformed) {
    const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: { ...descriptor(attackFixture.reportId), ...fields } });
    expect(response.status(), 'non-string fields must fail validation before DB/S3').toBe(400);
  }
});

test('G3 upload declared size and MIME fail closed', async ({ page, attackFixture }) => {
  const origin = new URL(page.url()).origin;
  for (const fileSize of [undefined, null, 0, -1, 1.5, '10', 10 * 1024 * 1024 + 1]) {
    const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: { ...descriptor(attackFixture.reportId), fileSize } });
    expect(response.status()).toBe(400);
  }
  for (const contentType of ['text/html', 'image/svg+xml', 'application/x-msdownload']) {
    const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: { ...descriptor(attackFixture.reportId), contentType } });
    expect(response.status()).toBe(400);
  }
});

test('G3 traversal filename cannot alter the key; real PNG PUT/confirm/download works', async ({ page, attackFixture }) => {
  const origin = new URL(page.url()).origin;
  const client = s3Fixture();
  const keys: string[] = [];
  try {
    const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: { ...descriptor(attackFixture.reportId), fileName: '../../other-tenant/x.tar/../outside' } });
    expect(response.status()).toBe(200);
    const upload = await response.json();
    keys.push(upload.key);
    expect(upload.key).toMatch(new RegExp('^media/codex-e1-a/report/' + attackFixture.reportId + '/[a-f0-9-]{36}\\.png$'));
    const url = new URL(upload.uploadUrl);
    expect(url.hostname).toBe('127.0.0.1');
    const put = await page.request.put(upload.uploadUrl, { headers: { 'Content-Type': 'image/png' }, data: tinyPng });
    expect(put.status()).toBe(200);
    const confirm = await page.request.post(`/api/media/${upload.mediaId}/confirm`, { headers: { Origin: origin }, data: {} });
    expect(confirm.status()).toBe(200);
    const record = await confirm.json();
    if (record.thumbnailKey) keys.push(record.thumbnailKey);
    expect(record.fileSize).toBe(tinyPng.length);
    const download = await page.request.get(`/api/media/${upload.mediaId}/download`);
    expect(download.status()).toBe(200);
    const signed = await download.json();
    expect(new URL(signed.url).hostname).toBe('127.0.0.1');
    const file = await page.request.get(signed.url);
    expect(file.status()).toBe(200);
    expect(await file.body()).toEqual(tinyPng);
  } finally {
    try { for (const Key of keys) await client.send(new DeleteObjectCommand({ Bucket: 'codex-photos', Key })); } finally { client.destroy(); }
  }
});

test('G3 HTML bytes and actual oversized S3 object cannot complete', async ({ page, attackFixture }) => {
  const origin = new URL(page.url()).origin;
  const client = s3Fixture();
  const keys: string[] = [];
  try {
    for (const contentType of ['image/jpeg', 'image/png', 'application/pdf']) {
      const bytes = Buffer.from(HTML_ATTACK);
      const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: { ...descriptor(attackFixture.reportId), contentType, fileSize: bytes.length } });
      expect(response.status()).toBe(200);
      const upload = await response.json();
      keys.push(upload.key);
      expect(new URL(upload.uploadUrl).hostname).toBe('127.0.0.1');
      expect((await page.request.put(upload.uploadUrl, { headers: { 'Content-Type': contentType }, data: bytes })).status()).toBe(200);
      expect((await page.request.post(`/api/media/${upload.mediaId}/confirm`, { headers: { Origin: origin }, data: {} })).status()).toBe(422);
      expect((await page.request.get(`/api/media/${upload.mediaId}/download`)).status()).toBe(409);
      const state = await attackFixture.db.query('SELECT "uploadStatus" FROM "Media" WHERE id=$1 AND "tenantId"=$2', [upload.mediaId, 'codex-e1-a']);
      expect(state.rows[0].uploadStatus).toBe('failed');
    }
    const response = await page.request.post('/api/media', { headers: { Origin: origin }, data: descriptor(attackFixture.reportId) });
    expect(response.status()).toBe(200);
    const upload = await response.json();
    keys.push(upload.key);
    // The fixture owner can seed a larger object directly, exercising the
    // server-side size gate independently of presigned ContentLength binding.
    await client.send(new PutObjectCommand({ Bucket: 'codex-photos', Key: upload.key, ContentType: 'image/png', Body: Buffer.concat([tinyPng, Buffer.alloc(10 * 1024 * 1024 + 1 - tinyPng.length)]) }));
    expect((await page.request.post(`/api/media/${upload.mediaId}/confirm`, { headers: { Origin: origin }, data: {} })).status()).toBe(413);
    expect((await page.request.get(`/api/media/${upload.mediaId}/download`)).status()).toBe(409);
  } finally {
    try { for (const Key of keys) await client.send(new DeleteObjectCommand({ Bucket: 'codex-photos', Key })); } finally { client.destroy(); }
  }
});

test('G3 actual PDF/xlsx exports preserve HTML and formulas as inert text', async ({ page, attackFixture }, info) => {
  const query = `siteId=${attackFixture.siteId}&dateFrom=2026-10-01&dateTo=2026-10-01`;
  const xlsx = await page.request.get(`/api/reports/export?format=xlsx&${query}`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  const archive = zipXml(await xlsx.body());
  const detail = archive.find(xml => xml.includes('G3FORMULA')) || '';
  expect(detail).toContain('&lt;script&gt;G3HTML&lt;/script&gt;');
  expect(detail).toContain('t="inlineStr"');
  for (const formula of FORMULA_ATTACKS) expect(detail).toContain(formula.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
  for (const xml of archive) {
    expect(xml).not.toMatch(/<f(?:\s|>)/);
    expect(xml).not.toMatch(/<(?:script|img)\b/i);
    expect(xml).not.toContain('TargetMode="External"');
  }
  const csv = await page.request.get(`/api/reports/export?format=csv&${query}`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  for (const formula of FORMULA_ATTACKS) expect(text).toContain('"\'' + formula.replace(/"/g, '""') + '"');
  const pdf = await page.request.get(`/api/reports/single-pdf?reportId=${attackFixture.reportId}&sync=1`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const evidence = pdfEvidence(bytes);
  expect(evidence.text).toContain('<script>G3HTML</script>');
  // The existing PDF table clips long comments with an ellipsis.
  expect(evidence.text).toContain('=HYPERLINK("https://');
  expect(evidence.text).toContain('+SUM(1,2)');
  expect(evidence.structure).not.toMatch(/\/(?:JavaScript|JS|Launch|OpenAction|AA|URI)\b/);
  await info.attach('attack-export-evidence', { body: Buffer.from(JSON.stringify({ xlsxText: true, formulaCells: 0, pdfLiteralHtml: true, pdfActiveActions: 0 })), contentType: 'application/json' });
});

test('G3 meter decrease respects acting safety role while ADMIN correction works', async ({ page, attackFixture }) => {
  const origin = new URL(page.url()).origin;
  const path = `/api/equipment/${attackFixture.equipmentId}/meter-readings`;
  const cache = async () => (await attackFixture.db.query('SELECT "engineHoursTotal" FROM "Equipment" WHERE id=$1 AND "tenantId"=$2', [attackFixture.equipmentId, 'codex-e1-a'])).rows[0].engineHoursTotal;
  const count = async () => Number((await attackFixture.db.query('SELECT count(*) AS count FROM "MeterReading" WHERE "equipmentId"=$1 AND "tenantId"=$2', [attackFixture.equipmentId, 'codex-e1-a'])).rows[0].count);
  expect(await cache()).toBe(200);
  const admin = await page.request.post(path, { headers: { Origin: origin }, data: { engineHours: 199, note: 'Codex G3 legitimate ADMIN correction' } });
  expect(admin.status()).toBe(201);
  const correction = await admin.json();
  expect(correction.reading.engineHours).toBe(199);
  expect((await page.request.delete(`${path}/${correction.reading.id}`, { headers: { Origin: origin } })).status()).toBe(200);
  expect(await count()).toBe(1);
  expect(await cache()).toBe(200);

  // This role can still record a normal increasing reading. The negative
  // assertion tests correction authority, rather than a denied route gate.
  const safety = { Origin: origin, 'x-acting-as': 'SAFETY_ENGINEER' };
  const increase = await page.request.post(path, { headers: safety, data: { engineHours: 201, note: 'Codex G3 safety normal reading' } });
  expect(increase.status()).toBe(201);
  const normal = await increase.json();
  expect((await page.request.delete(`${path}/${normal.reading.id}`, { headers: { Origin: origin } })).status()).toBe(200);
  expect(await cache()).toBe(200);
  const previousCount = await count();
  const decrease = await page.request.post(path, { headers: safety, data: { engineHours: 199, note: 'Codex G3 forbidden acting-role correction' } });
  expect(decrease.status(), 'SAFETY acting role must not inherit raw ADMIN correction authority').toBe(422);
  expect(await count()).toBe(previousCount);
  expect(await cache()).toBe(200);
});
