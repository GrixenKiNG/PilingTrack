#!/usr/bin/env node
// Frees a TCP port by killing the process that listens on it.
// Usage: node scripts/kill-port.js <port>
//
// Если освободить порт не удалось (чужой процесс, нужны права администратора),
// скрипт НЕ делает вид, что всё хорошо: он печатает, кто держит порт, и готовую
// команду для снятия — и выходит с ошибкой. Раньше отказ taskkill глотался
// (`stdio: 'ignore'` + выход 0), и разработчик получал загадочный EADDRINUSE от
// Next вместо «порт занят процессом N, нужны права администратора».
const { execSync } = require('node:child_process');

const port = Number(process.argv[2] || 3000);
if (!Number.isInteger(port) || port <= 0) {
  console.error(`kill-port: invalid port "${process.argv[2]}"`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[1]) === port) pids.add(m[2]);
      }
    } else {
      const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
      for (const p of out.split(/\s+/)) if (p) pids.add(p);
    }
  } catch {
    // no listeners — empty set
  }
  return [...pids];
}

/**
 * Кто это. Имя, родитель и командная строка — чтобы было видно, свой это
 * зависший dev-сервер или чужой процесс, который убивать не следует.
 *
 * Спрашиваем систему только когда снять процесс не удалось: на успешном пути
 * лишний запрос к WMI стоит около секунды на каждом `npm run dev`.
 */
function describeProcess(pid) {
  const unknown = { pid, name: 'неизвестно', parentPid: null, commandLine: null };
  // Пояснение к интерполяции ниже: pid приходит из netstat/lsof и уже отобран
  // регуляркой как цифры. Проверяем повторно и здесь — команда собирается в
  // строку для оболочки, и одной опечатки в вызывающем коде хватило бы, чтобы
  // сюда попало что-то другое.
  if (!/^\d+$/.test(String(pid))) return unknown;
  try {
    if (isWindows) {
      const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}";`
        + ` if ($p) { "$($p.Name)|$($p.ParentProcessId)|$($p.CommandLine)" }`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!out) return unknown;
      const [name, parentPid, ...rest] = out.split('|');
      return {
        pid,
        name: name || unknown.name,
        parentPid: parentPid || null,
        commandLine: rest.join('|').trim() || null,
      };
    }
    const out = execSync(`ps -o comm=,ppid= -p ${pid}`, { encoding: 'utf8' }).trim();
    const [name, parentPid] = out.split(/\s+/);
    return { pid, name: name || unknown.name, parentPid: parentPid || null, commandLine: null };
  } catch {
    return unknown;
  }
}

/** Команда, которую пользователь может скопировать как есть. */
function killCommand(pid, { tree = false } = {}) {
  return isWindows ? `taskkill /PID ${pid} /F${tree ? ' /T' : ''}` : `kill -9 ${pid}`;
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`kill-port: port ${port} is free`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (isWindows) {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGKILL');
    }
    console.log(`kill-port: killed PID ${pid} on port ${port}`);
  } catch {
    // Разбор — ниже, по факту повторной проверки: taskkill мог не сработать,
    // а порт всё равно освободиться (процесс умер сам).
  }
}

// Проверяем результат, а не намерение. Процессу нужен момент, чтобы отпустить
// сокет, поэтому короткая пауза перед повторным опросом.
execSync(isWindows ? 'powershell -NoProfile -Command "Start-Sleep -Milliseconds 700"' : 'sleep 0.7',
  { stdio: 'ignore' });
const stillHeld = pidsOnPort(port);
if (stillHeld.length === 0) {
  process.exit(0);
}

console.error('');
console.error(`kill-port: порт ${port} освободить не удалось.`);
console.error('');
for (const pid of stillHeld) {
  const info = describeProcess(pid);
  console.error(`  Держит порт: PID ${info.pid}  (${info.name})`);
  if (info.parentPid) console.error(`  Родитель:    PID ${info.parentPid}`);
  if (info.commandLine) console.error(`  Команда:     ${info.commandLine.slice(0, 160)}`);
  console.error('');
  console.error('  Снять — в терминале ОТ ИМЕНИ АДМИНИСТРАТОРА:');
  console.error(`      ${killCommand(pid)}`);
  if (info.parentPid && info.parentPid !== '0') {
    console.error('  Если процесс перезапускается сам — снимите вместе с родителем:');
    console.error(`      ${killCommand(info.parentPid, { tree: true })}`);
  }
  console.error('');
}
console.error(`После этого запустите снова. Проверить, что порт свободен:`);
console.error(isWindows
  ? `      netstat -ano | findstr ":${port} " | findstr LISTENING`
  : `      lsof -iTCP:${port} -sTCP:LISTEN`);
console.error('');
// Ненулевой код останавливает npm здесь, с понятной причиной, вместо того чтобы
// пропустить дальше и получить EADDRINUSE из глубины Next.
process.exit(1);
