import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculatePercentile,
  getMonitorAnalytics,
} from "./analytics-service";
import { prisma } from "../prisma";

vi.mock("../prisma", () => {
  return {
    prisma: {
      checkResult: {
        findMany: vi.fn(),
      },
      incident: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("Analytics Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculatePercentile", () => {
    it("returns null for empty array", () => {
      expect(calculatePercentile([], 95)).toBeNull();
    });

    it("returns single value when array has one element", () => {
      expect(calculatePercentile([42], 95)).toBe(42);
    });

    it("accurately computes P95 on distributed array of values", () => {
      // 100 values from 1 to 100
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = calculatePercentile(values, 95);
      expect(p95).toBe(95);
    });

    it("handles 0th and 100th percentiles", () => {
      const values = [10, 50, 90, 120];
      expect(calculatePercentile(values, 0)).toBe(10);
      expect(calculatePercentile(values, 100)).toBe(120);
    });

    it("does not mutate original array", () => {
      const values = [50, 10, 30];
      calculatePercentile(values, 95);
      expect(values).toEqual([50, 10, 30]);
    });
  });

  describe("getMonitorAnalytics", () => {
    it("computes sample-based uptime, average, and P95 latency for mixed results (mixed window)", async () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      (prisma.checkResult.findMany as any).mockResolvedValueOnce([
        { status: "UP", responseTimeMs: 40, checkedAt: tenMinutesAgo },
        { status: "UP", responseTimeMs: 50, checkedAt: tenMinutesAgo },
        { status: "UP", responseTimeMs: 60, checkedAt: tenMinutesAgo },
        { status: "DOWN", responseTimeMs: null, checkedAt: oneHourAgo },
      ]);

      (prisma.incident.findMany as any).mockResolvedValueOnce([
        {
          id: "inc-1",
          title: "Temporary network blip",
          cause: "Timeout",
          status: "RESOLVED",
          startedAt: oneHourAgo,
          resolvedAt: tenMinutesAgo,
          durationSeconds: 180,
        },
      ]);

      const analytics = await getMonitorAnalytics("mon-test-1");

      expect(analytics.monitorId).toBe("mon-test-1");
      expect(analytics.limitationNotice).toContain("Sample-based uptime computes the ratio");

      // 4 checks: 3 UP, 1 DOWN => 75% uptime
      const m24 = analytics.windows.last24Hours;
      expect(m24.totalChecks).toBe(4);
      expect(m24.upChecks).toBe(3);
      expect(m24.downChecks).toBe(1);
      expect(m24.uptimePercentage).toBe(75.0);
      expect(m24.avgResponseTimeMs).toBe(50); // (40+50+60)/3
      expect(m24.p95ResponseTimeMs).toBe(60);
      expect(m24.meanTimeToResolutionSeconds).toBe(180);
      expect(analytics.activeIncident).toBeNull();
    });

    it("returns null (no data) for uptimePercentage when no check records exist in window (empty window)", async () => {
      (prisma.checkResult.findMany as any).mockResolvedValueOnce([]);
      (prisma.incident.findMany as any).mockResolvedValueOnce([]);

      const analytics = await getMonitorAnalytics("mon-empty");

      const m24 = analytics.windows.last24Hours;
      expect(m24.totalChecks).toBe(0);
      expect(m24.upChecks).toBe(0);
      expect(m24.downChecks).toBe(0);
      expect(m24.uptimePercentage).toBeNull();
      expect(m24.avgResponseTimeMs).toBeNull();
      expect(m24.p95ResponseTimeMs).toBeNull();
      expect(m24.totalIncidents).toBe(0);
      expect(m24.resolvedIncidents).toBe(0);
      expect(m24.meanTimeToResolutionSeconds).toBeNull();

      expect(analytics.windows.last7Days.uptimePercentage).toBeNull();
      expect(analytics.windows.last30Days.uptimePercentage).toBeNull();
    });

    it("computes genuine 100% uptime when all checks succeed in window (all-success window)", async () => {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

      (prisma.checkResult.findMany as any).mockResolvedValueOnce([
        { status: "UP", responseTimeMs: 25, checkedAt: fiveMinutesAgo },
        { status: "UP", responseTimeMs: 30, checkedAt: fiveMinutesAgo },
        { status: "UP", responseTimeMs: 35, checkedAt: fiveMinutesAgo },
      ]);
      (prisma.incident.findMany as any).mockResolvedValueOnce([]);

      const analytics = await getMonitorAnalytics("mon-all-success");

      const m24 = analytics.windows.last24Hours;
      expect(m24.totalChecks).toBe(3);
      expect(m24.upChecks).toBe(3);
      expect(m24.downChecks).toBe(0);
      expect(m24.uptimePercentage).toBe(100.0);
      expect(m24.avgResponseTimeMs).toBe(30);
      expect(m24.p95ResponseTimeMs).toBe(35);
    });

    it("computes 0% uptime when all checks fail in window (all-failure window)", async () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      (prisma.checkResult.findMany as any).mockResolvedValueOnce([
        { status: "DOWN", responseTimeMs: null, checkedAt: tenMinutesAgo },
        { status: "DOWN", responseTimeMs: null, checkedAt: tenMinutesAgo },
      ]);
      (prisma.incident.findMany as any).mockResolvedValueOnce([]);

      const analytics = await getMonitorAnalytics("mon-all-failure");

      const m24 = analytics.windows.last24Hours;
      expect(m24.totalChecks).toBe(2);
      expect(m24.upChecks).toBe(0);
      expect(m24.downChecks).toBe(2);
      expect(m24.uptimePercentage).toBe(0.0);
      expect(m24.avgResponseTimeMs).toBeNull();
      expect(m24.p95ResponseTimeMs).toBeNull();
    });

    it("identifies active open incident if present", async () => {
      const now = new Date();
      (prisma.checkResult.findMany as any).mockResolvedValueOnce([]);
      (prisma.incident.findMany as any).mockResolvedValueOnce([
        {
          id: "inc-open-now",
          title: "Major Outage",
          cause: "502 Bad Gateway",
          status: "OPEN",
          startedAt: new Date(now.getTime() - 300000), // 5 min ago
          resolvedAt: null,
          durationSeconds: null,
        },
      ]);

      const analytics = await getMonitorAnalytics("mon-with-open-outage");

      expect(analytics.activeIncident).not.toBeNull();
      expect(analytics.activeIncident?.id).toBe("inc-open-now");
      expect(analytics.activeIncident?.durationSecondsSoFar).toBeGreaterThanOrEqual(300);
    });
  });
});
