import type { PrismaClient, Monitor } from "@prisma/client";
import { performHttpCheck, type HttpCheckOutcome } from "../lib/services/checker";
import { recordCheckResult } from "../lib/services/monitor-service";
import { claimDueMonitors, releaseMonitorLock } from "./scheduler";

export interface WorkerRunOptions {
  batchSize?: number;
  lockDurationMs?: number;
}

export interface WorkerIterationResult {
  claimedCount: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  errors: { monitorId: string; error: string }[];
}

/**
 * Executes a single check-and-record pass on an individual claimed monitor.
 * Wraps individual checks in try/catch so a failure on one monitor NEVER crashes the worker.
 */
export async function processMonitor(
  prisma: PrismaClient,
  monitor: Monitor
): Promise<{ success: boolean; outcome?: HttpCheckOutcome; error?: string }> {
  try {
    const outcome = await performHttpCheck({
      url: monitor.url,
      method: monitor.method as "GET" | "HEAD" | "POST",
      timeoutMs: monitor.timeoutMs,
      expectedStatusCode: monitor.expectedStatusCode,
    });

    // Record check in CheckResult and update Monitor status
    await recordCheckResult(monitor.id, outcome);

    // Release worker lock upon completion
    await releaseMonitorLock(prisma, monitor.id);

    return { success: true, outcome };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown check error";

    // Release lock even if check throws unexpectedly so monitor is not stuck
    await releaseMonitorLock(prisma, monitor.id);

    return { success: false, error: message };
  }
}

/**
 * Runs a single polling cycle:
 * 1. Atomically claims due monitors from database.
 * 2. Runs checks concurrently or sequentially.
 * 3. Handles errors gracefully.
 */
export async function runWorkerIteration(
  prisma: PrismaClient,
  options: WorkerRunOptions = {}
): Promise<WorkerIterationResult> {
  const dueMonitors = await claimDueMonitors(prisma, options);

  const result: WorkerIterationResult = {
    claimedCount: dueMonitors.length,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    errors: [],
  };

  if (dueMonitors.length === 0) {
    return result;
  }

  // Process all claimed monitors in parallel (with individual isolation)
  await Promise.all(
    dueMonitors.map(async (monitor) => {
      const res = await processMonitor(prisma, monitor);
      result.processedCount++;
      if (res.success) {
        result.successCount++;
      } else {
        result.failureCount++;
        result.errors.push({ monitorId: monitor.id, error: res.error || "Unknown error" });
      }
    })
  );

  return result;
}

export interface WorkerConfig {
  pollIntervalMs?: number;
  batchSize?: number;
  lockDurationMs?: number;
  logger?: (msg: string) => void;
}

/**
 * Continuous background monitoring worker class.
 * Manages interval polling, graceful shutdown, and overlap prevention.
 */
export class MonitoringWorker {
  private prisma: PrismaClient;
  private pollIntervalMs: number;
  private batchSize: number;
  private lockDurationMs: number;
  private log: (msg: string) => void;

  private isRunning = false;
  private isTickActive = false;
  private timer: NodeJS.Timeout | null = null;
  private stopPromiseResolve: (() => void) | null = null;

  constructor(prisma: PrismaClient, config: WorkerConfig = {}) {
    this.prisma = prisma;
    this.pollIntervalMs = Math.max(config.pollIntervalMs ?? 5000, 1000); // minimum 1s interval
    this.batchSize = config.batchSize ?? 10;
    this.lockDurationMs = config.lockDurationMs ?? 30000;
    this.log = config.logger ?? console.log;
  }

  /**
   * Starts the continuous monitoring loop.
   */
  start(): void {
    if (this.isRunning) {
      this.log("[Worker] Already running.");
      return;
    }

    this.isRunning = true;
    this.log(`[Worker] Started monitoring worker. Polling every ${this.pollIntervalMs}ms.`);

    const tick = async () => {
      if (!this.isRunning) return;

      // Prevent overlapping ticks: if previous poll is still in progress, skip this tick
      if (this.isTickActive) {
        this.log("[Worker] Previous check iteration still active; skipping tick.");
        return;
      }

      this.isTickActive = true;
      try {
        const iterationResult = await runWorkerIteration(this.prisma, {
          batchSize: this.batchSize,
          lockDurationMs: this.lockDurationMs,
        });

        if (iterationResult.processedCount > 0) {
          this.log(
            `[Worker] Polled ${iterationResult.processedCount} monitor(s) (Success: ${iterationResult.successCount}, Failed: ${iterationResult.failureCount})`
          );
        }
      } catch (err: unknown) {
        this.log(`[Worker] Unhandled error during poll iteration: ${err instanceof Error ? err.message : err}`);
      } finally {
        this.isTickActive = false;

        // Schedule next tick if still running
        if (this.isRunning) {
          this.timer = setTimeout(tick, this.pollIntervalMs);
        } else if (this.stopPromiseResolve) {
          this.stopPromiseResolve();
        }
      }
    };

    // Execute first tick immediately
    tick();
  }

  /**
   * Gracefully stops the worker, waiting for any active in-flight tick to complete.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.log("[Worker] Stopping worker gracefully...");
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.isTickActive) {
      this.log("[Worker] Waiting for in-flight checks to complete...");
      await new Promise<void>((resolve) => {
        this.stopPromiseResolve = resolve;
      });
    }

    this.log("[Worker] Worker stopped cleanly.");
  }

  get active(): boolean {
    return this.isRunning;
  }
}
