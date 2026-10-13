const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Load .env.local if present
if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring PostgreSQL partial unique constraint on incidents table...');
  // Ensure partial unique index: at most one OPEN incident per monitor
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_incident
    ON incidents ("monitorId")
    WHERE status = 'OPEN';
  `);
  console.log('Partial unique index idx_unique_open_incident verified/created successfully.');
}

main()
  .catch((err) => {
    console.error('Failed to create constraint:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
