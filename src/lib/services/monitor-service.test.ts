import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMonitor,
  recordCheckResult,
  executeAndRecordCheck,
} from "./monitor-service";
import { prisma } from "../prisma";
import * as checker from "./checker";

const mockTx = {
  checkResult: {
    create: vi.fn(),
  },
  monitor: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  incident: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  incidentEvent: {
    create: vi.fn(),
  },
};

vi.mock("../prisma", () => {
  return {
    prisma: {
      monitor: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      checkResult: {
        create: vi.fn(),
      },
      incident: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      incidentEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn((callback) => callback(mockTx)),
    },
  };
});

describe("Monitor Service - DB Persistence & Incident Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockTx.checkResult.create.mockResolvedValue({
      id: "res-1",
      monitorId: "mon-1",
      status: "UP",
      statusCode: 200,
      responseTimeMs: 42,
      errorMessage: null,
      checkedAt: new Date(),
    });

    mockTx.monitor.findUniqueOrThrow.mockResolvedValue({
      id: "mon-1",
      name: "API Monitor",
      consecutiveFailures: 0,
    });

    mockTx.monitor.update.mockResolvedValue({
      id: "mon-1",
      name: "API Monitor",
      currentStatus: "UP",
      lastCheckedAt: new Date(),
      consecutiveFailures: 0,
    });

    mockTx.incident.findFirst.mockResolvedValue(null);
    mockTx.incident.create.mockResolvedValue({
      id: "inc-1",
      monitorId: "mon-1",
      status: "OPEN",
      title: "Service Outage: API Monitor",
      cause: "HTTP 500",
      startedAt: new Date(),
    });
    mockTx.incident.update.mockResolvedValue({
      id: "inc-1",
      status: "RESOLVED",
      resolvedAt: new Date(),
      durationSeconds: 120,
    });
    mockTx.incidentEvent.create.mockResolvedValue({
      id: "evt-1",
      incidentId: "inc-1",
      type: "DETECTED",
      message: "Detected outage",
    });
  });

  it("creates a monitor with unique slug and PENDING status", async () => {
    (prisma.monitor.findUnique as any).mockResolvedValueOnce(null);
    (prisma.monitor.create as any).mockResolvedValueOnce({
      id: "mon-1",
      name: "API Monitor",
      slug: "api-monitor-a1b2",
      url: "https://example.com",
      method: "GET",
      currentStatus: "PENDING",
    });

    const result = await createMonitor({
      name: "API Monitor",
      slug: "api-monitor-a1b2",
      url: "https://example.com",
      method: "GET",
      intervalSeconds: 60,
      timeoutMs: 5000,
      expectedStatusCode: 200,
      isPublic: true,
    });

    expect(result.id).toBe("mon-1");
    expect(result.currentStatus).toBe("PENDING");
    expect(prisma.monitor.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "API Monitor",
          slug: "api-monitor-a1b2",
          currentStatus: "PENDING",
        }),
      })
    );
  });

  it("records a successful check result and resolves no incident if none open", async () => {
    const outcome: checker.HttpCheckOutcome = {
      status: "UP",
      statusCode: 200,
      responseTimeMs: 45,
      errorMessage: null,
      checkedAt: new Date(),
    };

    const { checkResult, monitor, incidentAction } = await recordCheckResult("mon-1", outcome);

    expect(checkResult.status).toBe("UP");
    expect(monitor.currentStatus).toBe("UP");
    expect(incidentAction).toBe("NONE");
    expect(mockTx.incident.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("does not create an incident if consecutive failures are below threshold (e.g. 1 or 2)", async () => {
    mockTx.monitor.findUniqueOrThrow.mockResolvedValueOnce({
      id: "mon-1",
      name: "API Monitor",
      consecutiveFailures: 1, // Will become 2 (below default threshold 3)
    });

    const outcome: checker.HttpCheckOutcome = {
      status: "DOWN",
      statusCode: 503,
      responseTimeMs: 120,
      errorMessage: "Service Unavailable",
      checkedAt: new Date(),
    };

    const { incidentAction } = await recordCheckResult("mon-1", outcome);

    expect(incidentAction).toBe("NONE");
    expect(mockTx.incident.create).not.toHaveBeenCalled();
    expect(mockTx.incidentEvent.create).not.toHaveBeenCalled();
  });

  it("automatically creates an incident and DETECTED event when consecutive failures reach threshold (3)", async () => {
    mockTx.monitor.findUniqueOrThrow.mockResolvedValueOnce({
      id: "mon-1",
      name: "API Monitor",
      consecutiveFailures: 2, // Will become 3 (meeting default threshold of 3)
    });
    mockTx.incident.findFirst.mockResolvedValueOnce(null); // No existing open incident

    const checkTime = new Date();
    const outcome: checker.HttpCheckOutcome = {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 250,
      errorMessage: "Internal Server Error",
      checkedAt: checkTime,
    };

    const { incidentAction, incident } = await recordCheckResult("mon-1", outcome);

    expect(incidentAction).toBe("CREATED");
    expect(incident?.id).toBe("inc-1");
    expect(mockTx.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          monitorId: "mon-1",
          status: "OPEN",
          title: "Service Outage: API Monitor",
          cause: "Internal Server Error",
          startedAt: checkTime,
        }),
      })
    );
    expect(mockTx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "inc-1",
          type: "DETECTED",
        }),
      })
    );
  });

  it("does not create a duplicate incident if an incident is already OPEN", async () => {
    mockTx.monitor.findUniqueOrThrow.mockResolvedValueOnce({
      id: "mon-1",
      name: "API Monitor",
      consecutiveFailures: 4, // 5th failure
    });
    // Existing open incident already present
    mockTx.incident.findFirst.mockResolvedValueOnce({
      id: "inc-already-open",
      monitorId: "mon-1",
      status: "OPEN",
    });

    const outcome: checker.HttpCheckOutcome = {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 200,
      errorMessage: "Server error",
      checkedAt: new Date(),
    };

    const { incidentAction, incident } = await recordCheckResult("mon-1", outcome);

    expect(incidentAction).toBe("NONE");
    expect(incident.id).toBe("inc-already-open");
    expect(mockTx.incident.create).not.toHaveBeenCalled();
  });

  it("automatically resolves an open incident and logs RESOLVED event on recovery check", async () => {
    const startedAt = new Date(Date.now() - 150000); // 150 seconds ago
    const resolvedAt = new Date();

    mockTx.incident.findFirst.mockResolvedValueOnce({
      id: "inc-to-resolve",
      monitorId: "mon-1",
      status: "OPEN",
      startedAt,
    });

    mockTx.incident.update.mockResolvedValueOnce({
      id: "inc-to-resolve",
      status: "RESOLVED",
      resolvedAt,
      durationSeconds: 150,
    });

    const outcome: checker.HttpCheckOutcome = {
      status: "UP",
      statusCode: 200,
      responseTimeMs: 38,
      errorMessage: null,
      checkedAt: resolvedAt,
    };

    const { incidentAction, incident } = await recordCheckResult("mon-1", outcome);

    expect(incidentAction).toBe("RESOLVED");
    expect(incident.id).toBe("inc-to-resolve");
    expect(mockTx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "inc-to-resolve" },
        data: expect.objectContaining({
          status: "RESOLVED",
          resolvedAt,
          durationSeconds: 150,
        }),
      })
    );
    expect(mockTx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "inc-to-resolve",
          type: "RESOLVED",
        }),
      })
    );
  });

  it("handles race condition (P2002 unique constraint violation) gracefully without failing transaction", async () => {
    mockTx.monitor.findUniqueOrThrow.mockResolvedValueOnce({
      id: "mon-1",
      name: "API Monitor",
      consecutiveFailures: 2,
    });
    mockTx.incident.findFirst
      .mockResolvedValueOnce(null) // first check sees null
      .mockResolvedValueOnce({ id: "inc-concurrent", status: "OPEN" }); // subsequent query finds the concurrently opened one

    // Simulate Prisma P2002 error from Postgres unique index
    const p2002Error: any = new Error("Unique constraint violation");
    p2002Error.code = "P2002";
    mockTx.incident.create.mockRejectedValueOnce(p2002Error);

    const outcome: checker.HttpCheckOutcome = {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 250,
      errorMessage: "Server error",
      checkedAt: new Date(),
    };

    const { incidentAction, incident } = await recordCheckResult("mon-1", outcome);

    expect(incidentAction).toBe("NONE");
    expect(incident.id).toBe("inc-concurrent");
  });

  it("orchestrates executeAndRecordCheck end-to-end", async () => {
    (prisma.monitor.findUnique as any).mockResolvedValueOnce({
      id: "mon-1",
      url: "https://example.com",
      method: "GET",
      timeoutMs: 5000,
      expectedStatusCode: 200,
    });

    vi.spyOn(checker, "performHttpCheck").mockResolvedValueOnce({
      status: "UP",
      statusCode: 200,
      responseTimeMs: 35,
      errorMessage: null,
      checkedAt: new Date(),
    });

    const result = await executeAndRecordCheck("mon-1");

    expect(result.monitor.id).toBe("mon-1");
    expect(result.checkResult.status).toBe("UP");
  });
});
