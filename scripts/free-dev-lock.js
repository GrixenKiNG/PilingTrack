#!/usr/bin/env node
// Снимает замок dev-сервера Next, оставшийся от предыдущего запуска.
// Usage: node scripts/free-dev-lock.js
//
// ЗАЧЕМ ОТДЕЛЬНО ОТ kill-port. Next 16 не даёт запустить второй dev-сервер для
// ОДНОГО КАТАЛОГА и держит замок `.next/dev/lock` с pid и портом. Порт там не
// обязательно 3000: сервер, поднятый когда-то на 3001, держит замок так же.
// Поэтому `kill-port.js 3000` его не видит — порт 3000 свободен, а новый
// `next dev` всё равно печатает «Ready», тут же пишет «Another next dev server
// is already running» и умирает. Снаружи это выглядит как «start.bat
// обрывается»: окно отработало и погасло.
//
// Замок лежит внутри `.next` этого проекта, так что записанный в нём процесс —
// заведомо наш dev-сервер. Но номер процесса мог быть переиспользован системой,
// поэтому перед снятием проверяем, что это действительно node.
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const lockPath = path.join(process.cwd(), '.next', 'dev', 'lock');

function readLock() {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return null; // замка нет — обычный случай
  }
  try {
    const lock = JSON.parse(raw);
    if (!Number.isInteger(lock.pid) || lock.pid <= 0) return null;
    return lock;
  } catch {
    console.log('free-dev-lock: замок повреждён, удаляю');
    try { fs.unlinkSync(lockPath); } catch { /* уже нет */ }
    return null;
  }
}

/** Имя процесса или null, если процесса нет. */
function processName(pid) {
  if (!/^\d+$/.test(String(pid))) return null;
  try {
    if (isWindows) {
      const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.Name }`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out || null;
    }
    return execSync(`ps -p ${pid} -o comm=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // существует, но не наш — считаем живым
  }
}

const lock = readLock();
if (!lock) {
  console.log('free-dev-lock: замок dev-сервера не найден');
  process.exit(0);
}

const { pid, port } = lock;

if (!alive(pid)) {
  try { fs.unlinkSync(lockPath); } catch { /* гонка с самим Next — не беда */ }
  console.log(`free-dev-lock: замок от мёртвого PID ${pid} удалён`);
  process.exit(0);
}

// Защита от переиспользованного номера процесса: чужое не трогаем.
const name = processName(pid);
if (name && !/^node(\.exe)?$/i.test(name)) {
  console.error('');
  console.error(`free-dev-lock: PID ${pid} из замка — это "${name}", а не node.`);
  console.error('Похоже, система переиспользовала номер процесса. Не трогаю его.');
  console.error(`Удалите замок вручную и запустите снова:  del "${lockPath}"`);
  console.error('');
  process.exit(1);
}

try {
  if (isWindows) {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
  } else {
    process.kill(pid, 'SIGKILL');
  }
} catch {
  // Разбираем по факту ниже, а не по коду возврата taskkill.
}

execSync(isWindows ? 'powershell -NoProfile -Command "Start-Sleep -Milliseconds 700"' : 'sleep 0.7',
  { stdio: 'ignore' });

if (alive(pid)) {
  console.error('');
  console.error(`free-dev-lock: снять dev-сервер (PID ${pid}, порт ${port}) не удалось.`);
  console.error('');
  console.error('  Снять — в терминале ОТ ИМЕНИ АДМИНИСТРАТОРА:');
  console.error(`      taskkill /PID ${pid} /F /T`);
  console.error('');
  console.error('  Пока он жив, новый `next dev` будет запускаться и сразу гаснуть.');
  console.error('');
  process.exit(1);
}

try { fs.unlinkSync(lockPath); } catch { /* Next мог удалить сам при завершении */ }
console.log(`free-dev-lock: снят прежний dev-сервер (PID ${pid}, порт ${port})`);
