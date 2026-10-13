import { describe, it, expect, vi, beforeEach } from "vitest";
import { isMonitorDue, isMonitorLocked, claimDueMonitors, releaseMonitorLock } from "./scheduler";
import { processMonitor, runWorkerIteration, MonitoringWorker } from "./runner";
import * as checker from "../lib/services/checker";
import * as monitorService from "../lib/services/monitor-service";

describe("Worker Scheduler - Due Logic & Locks", () => {
  it("determines that monitors without previous checks are immediately due", () => {
    const monitor = { lastCheckedAt: null, intervalSeconds: 60 };
    expect(isMonitorDue(monitor)).toBe(true);
  });

  it("determines that monitors checked recently are not due", () => {
    const now = new Date("2026-10-10T12:00:30Z");
    const lastCheckedAt = new Date("2026-10-10T12:00:00Z"); // 30s ago, interval 60s
    const monitor = { lastCheckedAt, intervalSeconds: 60 };

    expect(isMonitorDue(monitor, now)).toBe(false);
  });

  it("determines that monitors whose interval has elapsed are due", () => {
    const now = new Date("2026-10-10T12:01:05Z");
    const lastCheckedAt = new Date("2026-10-10T12:00:00Z"); // 65s ago, interval 60s
    const monitor = { lastCheckedAt, intervalSeconds: 60 };

    expect(isMonitorDue(monitor, now)).toBe(true);
  });

  it("correctly identifies active and expired locks", () => {
    const now = new Date("2026-10-10T12:00:00Z");

    // Locked until 30s in the future
    expect(isMonitorLocked({ lockedUntil: new Date("2026-10-10T12:00:30Z") }, now)).toBe(true);

    // Lock expired 10s ago
    expect(isMonitorLocked({ lockedUntil: new Date("2026-10-10T11:59:50Z") }, now)).toBe(false);

    // No lock
    expect(isMonitorLocked({ lockedUntil: null }, now)).toBe(false);
  });
});

describe("Worker Claiming & Duplicate Prevention", () => {
  it("claims due monitors and prevents overlapping claims", async () => {
    const mockMonitors = [
      {
        id: "mon-1",
        name: "Due Monitor 1",
        isActive: true,
        intervalSeconds: 60,
        lastCheckedAt: null,
        lockedUntil: null,
      },
      {
        id: "mon-2",
        name: "Locked Monitor",
        isActive: true,
        intervalSeconds: 60,
        lastCheckedAt: null,
        lockedUntil: new Date(Date.now() + 60000), // locked by another worker
      },
    ];

    const mockPrisma: any = {
      $queryRaw: vi.fn().mockRejectedValueOnce(new Error("Raw SQL not supported in mock")),
      $transaction: vi.fn(async (callback) => {
        return callback({
          monitor: {
            findMany: vi.fn().mockResolvedValue([mockMonitors[0]]),
            update: vi.fn().mockImplementation(({ where, data }) => ({
              ...mockMonitors[0],
              ...data,
            })),
          },
        });
      }),
    };

    const claimed = await claimDueMonitors(mockPrisma, { batchSize: 5 });

    expect(claimed.length).toBe(1);
    expect(claimed[0].id).toBe("mon-1");
    expect(claimed[0].lockedUntil).toBeDefined();
  });

  it("releases monitor lock cleanly", async () => {
    const mockPrisma: any = {
      monitor: {
        update: vi.fn().mockResolvedValue({ id: "mon-1", lockedUntil: null }),
      },
    };

    await releaseMonitorLock(mockPrisma, "mon-1");
    expect(mockPrisma.monitor.update).toHaveBeenCalledWith({
      where: { id: "mon-1" },
      data: { lockedUntil: null },
    });
  });
});

describe("Worker Execution & Failure Isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a monitor check and records the result without crashing", async () => {
    const mockMonitor: any = {
      id: "mon-1",
      url: "https://example.com",
      method: "GET",
      timeoutMs: 5000,
      expectedStatusCode: 200,
    };

    const mockOutcome: checker.HttpCheckOutcome = {
      status: "UP",
      statusCode: 200,
      responseTimeMs: 50,
      errorMessage: null,
      checkedAt: new Date(),
    };

    vi.spyOn(checker, "performHttpCheck").mockResolvedValueOnce(mockOutcome);
    vi.spyOn(monitorService, "recordCheckResult").mockResolvedValueOnce({} as any);

    const mockPrisma: any = {
      monitor: {
        update: vi.fn().mockResolvedValue({ id: "mon-1", lockedUntil: null }),
      },
    };

    const result = await processMonitor(mockPrisma, mockMonitor);

    expect(result.success).toBe(true);
    expect(result.outcome?.status).toBe("UP");
    expect(mockPrisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mon-1" },
        data: { lockedUntil: null },
      })
    );
  });

  it("safely handles individual probe exceptions without crashing", async () => {
    const mockMonitor: any = {
      id: "mon-failing",
      url: "https://bad-host.xyz",
      method: "GET",
      timeoutMs: 5000,
      expectedStatusCode: 200,
    };

    vi.spyOn(checker, "performHttpCheck").mockRejectedValueOnce(
      new Error("Fatal network error")
    );

    const mockPrisma: any = {
      monitor: {
        update: vi.fn().mockResolvedValue({ id: "mon-failing", lockedUntil: null }),
      },
    };

    const result = await processMonitor(mockPrisma, mockMonitor);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Fatal network error");
    // Lock must still be released so the monitor is not stuck
    expect(mockPrisma.monitor.update).toHaveBeenCalled();
  });

  it("runs an iteration over multiple monitors handling mixed success/failure", async () => {
    const mockPrisma: any = {
      $queryRaw: vi.fn().mockResolvedValueOnce([
        { id: "mon-1", url: "https://site1.com", method: "GET", timeoutMs: 5000, expectedStatusCode: 200 },
        { id: "mon-2", url: "https://site2.com", method: "GET", timeoutMs: 5000, expectedStatusCode: 200 },
      ]),
      monitor: {
        update: vi.fn().mockResolvedValue({}),
      },
    };

    // Monitor 1 succeeds, Monitor 2 fails
    vi.spyOn(checker, "performHttpCheck")
      .mockResolvedValueOnce({
        status: "UP",
        statusCode: 200,
        responseTimeMs: 30,
        errorMessage: null,
        checkedAt: new Date(),
      })
      .mockResolvedValueOnce({
        status: "DOWN",
        statusCode: 500,
        responseTimeMs: 40,
        errorMessage: "Expected HTTP status 200, but received 500.",
        checkedAt: new Date(),
      });

    vi.spyOn(monitorService, "recordCheckResult").mockResolvedValue({} as any);

    const summary = await runWorkerIteration(mockPrisma, { batchSize: 2 });

    expect(summary.claimedCount).toBe(2);
    expect(summary.processedCount).toBe(2);
    expect(summary.successCount).toBe(2); // Both processed successfully to DB
  });
});

describe("MonitoringWorker Lifecycle", () => {
  it("starts, runs ticks, and stops gracefully", async () => {
    const logMessages: string[] = [];
    const mockPrisma: any = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    const worker = new MonitoringWorker(mockPrisma, {
      pollIntervalMs: 5000,
      logger: (msg) => logMessages.push(msg),
    });

    expect(worker.active).toBe(false);

    worker.start();
    expect(worker.active).toBe(true);

    await worker.stop();
    expect(worker.active).toBe(false);
    expect(logMessages.some((m) => m.includes("Started monitoring worker"))).toBe(true);
    expect(logMessages.some((m) => m.includes("Worker stopped cleanly"))).toBe(true);
  });
});

