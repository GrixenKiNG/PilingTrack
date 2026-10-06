// Local-only Telegram HTTP transport for a disposable stand; no remote messages.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const requests = [];
const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || !/^\/bot[^/]+\/(getChat|sendMessage|sendDocument)$/.test(request.url || '')) {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  request.on('end', () => {
    const method = request.url.split('/').pop();
    requests.push(method); // Do not retain bot token or message content.
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: method === 'getChat' ? { title: 'Owned disposable fixture' } : { message_id: requests.length } }));
  });
});
server.listen(0, '127.0.0.1', () => {
  const child = spawn(process.execPath, process.argv.slice(2), {
    env: { ...process.env, TELEGRAM_API_BASE: 'http://127.0.0.1:' + server.address().port },
    stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; server.close(); });
  child.on('exit', (code, signal) => {
    const output = path.resolve('output/codex-t7/telegram-transport.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ requests }, null, 2));
    server.closeAllConnections();
    server.close();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
});