const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const env = { ...process.env };

// Load environment variables from .env.local if present
if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!env[key]) {
        env[key] = val;
      }
    }
  }
}

function run() {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'cmd.exe' : 'npx';
  const args = isWin
    ? ['/c', 'npx', 'tsx', 'scripts/seed-operator.ts']
    : ['tsx', 'scripts/seed-operator.ts'];

  const res = spawnSync(cmd, args, {
    env,
    stdio: 'inherit',
  });

  process.exit(res.status ?? 0);
}

if (require.main === module) {
  run();
}

module.exports = { run };

