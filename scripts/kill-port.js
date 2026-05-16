#!/usr/bin/env node
// Frees a TCP port by killing the process that listens on it.
// Usage: node scripts/kill-port.js <port>
const { execSync } = require('node:child_process');

const port = Number(process.argv[2] || 3000);
if (!Number.isInteger(port) || port <= 0) {
  console.error(`kill-port: invalid port "${process.argv[2]}"`);
  process.exit(1);
}

function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
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

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`kill-port: port ${port} is free`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGKILL');
    }
    console.log(`kill-port: killed PID ${pid} on port ${port}`);
  } catch (e) {
    console.warn(`kill-port: failed to kill PID ${pid}: ${e.message}`);
  }
}
