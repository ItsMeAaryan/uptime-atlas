import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMonitor,
  recordCheckResult,
  executeAndRecordCheck,
} from "./monitor-service";
import { prisma } from "../prisma";
import * as checker from "./checker";

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
      $transaction: vi.fn((callback) =>
        callback({
          checkResult: {
            create: vi.fn().mockResolvedValue({
              id: "res-1",
              monitorId: "mon-1",
              status: "UP",
              statusCode: 200,
              responseTimeMs: 42,
              errorMessage: null,
              checkedAt: new Date(),
            }),
          },
          monitor: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              consecutiveFailures: 0,
            }),
            update: vi.fn().mockResolvedValue({
              id: "mon-1",
              name: "Test Monitor",
              currentStatus: "UP",
              lastCheckedAt: new Date(),
              consecutiveFailures: 0,
            }),
          },
        })
      ),
    },
  };
});

describe("Monitor Service - DB Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("records a successful check result and updates monitor state", async () => {
    const outcome: checker.HttpCheckOutcome = {
      status: "UP",
      statusCode: 200,
      responseTimeMs: 45,
      errorMessage: null,
      checkedAt: new Date(),
    };

    const { checkResult, monitor } = await recordCheckResult("mon-1", outcome);

    expect(checkResult.status).toBe("UP");
    expect(monitor.currentStatus).toBe("UP");
    expect(prisma.$transaction).toHaveBeenCalled();
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
