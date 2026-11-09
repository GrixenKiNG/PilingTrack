import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const pages = new Set([
  'index.html', 'objects.html', 'fleet.html',
  'project-school-university.html', 'project-m12.html', 'project-microdistrict.html',
]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
) {
  const segments = (await context.params).path ?? [];
  const filename = segments.length === 0 ? 'index.html' : segments.join('/');
  if (!pages.has(filename)) return new Response('Not found', { status: 404 });

  // The existing proxy supplies a fresh nonce and CSP for every HTML request.
  const nonce = request.headers.get('x-nonce');
  if (!nonce || !/^[A-Za-z0-9+/=]+$/.test(nonce)) {
    return new Response('Site temporarily unavailable', { status: 503 });
  }

  const file = path.join(process.cwd(), 'public', 'orion-release', filename);
  const template = await readFile(file, 'utf8');
  const html = template.replace(/<script\b/g, `<script nonce="${nonce}"`);
  return new Response(request.method === 'HEAD' ? null : html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const HEAD = GET;
