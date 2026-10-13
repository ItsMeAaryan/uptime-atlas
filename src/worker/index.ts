import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { MonitoringWorker } from "./runner";

// 1. Load environment variables from .env.local if DATABASE_URL is not yet set
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

// 2. Worker configuration
const pollIntervalMs = Number.parseInt(process.env.WORKER_POLL_INTERVAL_MS || "5000", 10);
const batchSize = Number.parseInt(process.env.WORKER_BATCH_SIZE || "10", 10);
const lockDurationMs = Number.parseInt(process.env.WORKER_LOCK_DURATION_MS || "30000", 10);

console.log("==================================================");
console.log("▲ Uptime Atlas - Background Monitoring Worker");
console.log("==================================================");
console.log(`[Config] Polling interval : ${pollIntervalMs}ms`);
console.log(`[Config] Batch size       : ${batchSize}`);
console.log(`[Config] Lock duration    : ${lockDurationMs}ms`);
console.log(`[Config] Node process PID : ${process.pid}`);
console.log("--------------------------------------------------");

const worker = new MonitoringWorker(prisma, {
  pollIntervalMs,
  batchSize,
  lockDurationMs,
  logger: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
});

// 3. Graceful shutdown handler
async function handleShutdown(signal: string) {
  console.log(`\n[${new Date().toISOString()}] Received ${signal}. Initiating graceful worker shutdown...`);
  await worker.stop();
  await prisma.$disconnect();
  console.log(`[${new Date().toISOString()}] Worker shut down safely. Exiting.`);
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// 4. Start worker
worker.start();

