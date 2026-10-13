const fs = require('fs');
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

const args = process.argv.slice(2);
const res = spawnSync('npx', ['prisma', ...args], {
  env,
  stdio: 'inherit',
  shell: true,
});

process.exit(res.status ?? 0);
