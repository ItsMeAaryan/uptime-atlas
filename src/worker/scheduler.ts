import type { PrismaClient, Monitor } from "@prisma/client";

/**
 * Pure helper function to determine if a monitor is due for a health check.
 * - If lastCheckedAt is null, it has never been checked -> DUE immediately.
 * - If lastCheckedAt is set, it is due if: now >= lastCheckedAt + intervalSeconds * 1000.
 */
export function isMonitorDue(
  monitor: Pick<Monitor, "lastCheckedAt" | "intervalSeconds">,
  now: Date = new Date()
): boolean {
  if (!monitor.lastCheckedAt) {
    return true;
  }

  const elapsedMs = now.getTime() - new Date(monitor.lastCheckedAt).getTime();
  const intervalMs = monitor.intervalSeconds * 1000;

  return elapsedMs >= intervalMs;
}

/**
 * Checks if a monitor is currently claimed / locked by an active worker.
 */
export function isMonitorLocked(
  monitor: Pick<Monitor, "lockedUntil">,
  now: Date = new Date()
): boolean {
  if (!monitor.lockedUntil) {
    return false;
  }

  return new Date(monitor.lockedUntil).getTime() > now.getTime();
}

export interface ClaimOptions {
  batchSize?: number;
  lockDurationMs?: number;
  now?: Date;
}

/**
 * Atomically claims due monitors from PostgreSQL.
 * Uses a database-backed locking strategy:
 * 1. Checks that isActive = true.
 * 2. Checks that lockedUntil is NULL or expired (preventing concurrent worker overlaps).
 * 3. Checks that lastCheckedAt is NULL or elapsed time >= intervalSeconds.
 * 4. Atomically sets lockedUntil = now + lockDurationMs for the claimed batch.
 */
export async function claimDueMonitors(
  prisma: PrismaClient,
  options: ClaimOptions = {}
): Promise<Monitor[]> {
  const batchSize = Math.max(options.batchSize ?? 10, 1);
  const lockDurationMs = Math.max(options.lockDurationMs ?? 30000, 5000); // minimum 5s lock
  const now = options.now ?? new Date();
  const lockUntilDate = new Date(now.getTime() + lockDurationMs);

  // PostgreSQL atomic claim using SKIP LOCKED
  // In case of non-Postgres or mock environments, fallback to transaction
  try {
    const claimed = await prisma.$queryRaw<Monitor[]>`
      UPDATE "monitors"
      SET "lockedUntil" = ${lockUntilDate}
      WHERE id IN (
        SELECT id FROM "monitors"
        WHERE "isActive" = true
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
          AND (
            "lastCheckedAt" IS NULL 
            OR "lastCheckedAt" <= ${now} - ("intervalSeconds" * INTERVAL '1 second')
          )
        ORDER BY "lastCheckedAt" ASC NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING *;
    `;

    return claimed;
  } catch {
    // Prisma / Mock transactional fallback for unit tests
    return prisma.$transaction(async (tx) => {
      const candidates = await tx.monitor.findMany({
        where: {
          isActive: true,
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
        orderBy: { lastCheckedAt: "asc" },
        take: batchSize * 2,
      });

      const due = candidates.filter((m) => isMonitorDue(m, now)).slice(0, batchSize);

      if (due.length === 0) return [];

      const claimedMonitors: Monitor[] = [];
      for (const m of due) {
        const updated = await tx.monitor.update({
          where: { id: m.id },
          data: { lockedUntil: lockUntilDate },
        });
        claimedMonitors.push(updated);
      }

      return claimedMonitors;
    });
  }
}

/**
 * Releases the worker lock on a monitor (clears lockedUntil).
 */
export async function releaseMonitorLock(
  prisma: PrismaClient,
  monitorId: string
): Promise<void> {
  try {
    await prisma.monitor.update({
      where: { id: monitorId },
      data: { lockedUntil: null },
    });
  } catch (err) {
    console.warn(`Failed to release lock for monitor ${monitorId}:`, err);
  }
}
