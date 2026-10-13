import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generatePublicId,
  toggleMonitorPublication,
  regeneratePublicId,
  getStatusPageData,
  calculate90DayCalendar,
  sanitizePublicEventMessage,
} from "./status-page-service";
import { prisma } from "../prisma";
import * as analyticsService from "./analytics-service";

vi.mock("../prisma", () => {
  return {
    prisma: {
      monitor: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      incident: {
        findMany: vi.fn(),
      },
      checkResult: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("Status Page Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generatePublicId", () => {
    it("generates a non-guessable secure identifier prefixed with pub_", () => {
      const id1 = generatePublicId();
      const id2 = generatePublicId();

      expect(id1).toMatch(/^pub_[a-f0-9]{32}$/);
      expect(id2).toMatch(/^pub_[a-f0-9]{32}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("sanitizePublicEventMessage", () => {
    it("sanitizes automated DETECTED and RESOLVED messages", () => {
      expect(
        sanitizePublicEventMessage(
          "DETECTED",
          "Automated probe detected outage. Root cause: Connection refused by target server."
        )
      ).toBe("Automated probe detected service outage.");

      expect(
        sanitizePublicEventMessage(
          "RESOLVED",
          "Service recovered. Endpoint responded with HTTP status 200 (150ms)."
        )
      ).toBe("Service recovered and operational.");
    });

    it("redacts sensitive URLs, IP addresses, and tokens from operator notes", () => {
      const raw =
        "Investigating backend failure at https://internal-db.corp.local:5432/db with token=secretToken123 and IP 192.168.1.50";
      const sanitized = sanitizePublicEventMessage("INVESTIGATING", raw);

      expect(sanitized).not.toContain("https://internal-db.corp.local:5432/db");
      expect(sanitized).not.toContain("secretToken123");
      expect(sanitized).not.toContain("192.168.1.50");
      expect(sanitized).toContain("[redacted]");
    });
  });

  describe("toggleMonitorPublication", () => {
    it("generates a new publicId when enabling publication for the first time", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce({
        id: "mon-123",
        name: "Test API",
        isPublic: false,
        publicId: null,
      });

      (prisma.monitor.update as any).mockImplementationOnce(({ data }: any) => ({
        id: "mon-123",
        name: "Test API",
        isPublic: data.isPublic,
        publicId: data.publicId,
      }));

      const result = await toggleMonitorPublication("mon-123", true);

      expect(result.isPublic).toBe(true);
      expect(result.publicId).toMatch(/^pub_[a-f0-9]{32}$/);
      expect(prisma.monitor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mon-123" },
          data: expect.objectContaining({
            isPublic: true,
            publicId: expect.stringMatching(/^pub_[a-f0-9]{32}$/),
          }),
        })
      );
    });

    it("preserves existing publicId when toggling to private", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce({
        id: "mon-123",
        name: "Test API",
        isPublic: true,
        publicId: "pub_existing_token_123",
      });

      (prisma.monitor.update as any).mockImplementationOnce(({ data }: any) => ({
        id: "mon-123",
        name: "Test API",
        isPublic: data.isPublic,
        publicId: data.publicId,
      }));

      const result = await toggleMonitorPublication("mon-123", false);

      expect(result.isPublic).toBe(false);
      expect(result.publicId).toBe("pub_existing_token_123");
    });
  });

  describe("regeneratePublicId", () => {
    it("replaces publicId with a new distinct token", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce({
        id: "mon-123",
        name: "Test API",
        isPublic: true,
        publicId: "pub_old_token",
      });

      (prisma.monitor.update as any).mockImplementationOnce(({ data }: any) => ({
        id: "mon-123",
        name: "Test API",
        isPublic: true,
        publicId: data.publicId,
      }));

      const result = await regeneratePublicId("mon-123");

      expect(result.publicId).toMatch(/^pub_[a-f0-9]{32}$/);
      expect(result.publicId).not.toBe("pub_old_token");
    });

    it("throws an error when monitor is not found", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce(null);

      await expect(regeneratePublicId("mon-nonexistent")).rejects.toThrow(
        'Monitor with ID "mon-nonexistent" not found.'
      );
    });
  });

  describe("calculate90DayCalendar", () => {
    it("generates exactly 90 days in UTC starting 89 days ago up to reference date", async () => {
      // Fixed reference date: 2026-10-10T12:00:00Z
      const refDate = new Date("2026-10-10T12:00:00Z");

      (prisma.checkResult.findMany as any).mockResolvedValueOnce([]);
      (prisma.incident.findMany as any).mockResolvedValueOnce([]);

      const calendar = await calculate90DayCalendar("mon-123", refDate);

      expect(calendar.timezone).toBe("UTC");
      expect(calendar.rangeDays).toBe(90);
      expect(calendar.days).toHaveLength(90);
      expect(calendar.periodEnd).toBe("2026-10-10");
      expect(calendar.periodStart).toBe("2026-07-13"); // 89 days before 2026-10-10
      expect(calendar.overallUptimePercentage).toBeNull();
      expect(calendar.totalChecks).toBe(0);

      // Verify every day in empty history is NO_DATA with null uptime
      for (const day of calendar.days) {
        expect(day.status).toBe("NO_DATA");
        expect(day.uptimePercentage).toBeNull();
        expect(day.totalChecks).toBe(0);
      }
    });

    it("correctly computes daily uptime percentage, counts, and status categories", async () => {
      const refDate = new Date("2026-10-10T12:00:00Z");

      // Mock checks:
      // Day 2026-10-10 (today): 2 UP, 0 DOWN -> OPERATIONAL (100%)
      // Day 2026-10-09: 1 UP, 1 DOWN -> DEGRADED (50%)
      // Day 2026-10-08: 0 UP, 2 DOWN -> OUTAGE (0%)
      // All other days: 0 checks -> NO_DATA (null)
      const mockChecks = [
        {
          status: "UP",
          responseTimeMs: 100,
          checkedAt: new Date("2026-10-10T02:00:00Z"),
        },
        {
          status: "UP",
          responseTimeMs: 200,
          checkedAt: new Date("2026-10-10T08:00:00Z"),
        },
        {
          status: "UP",
          responseTimeMs: 150,
          checkedAt: new Date("2026-10-09T03:00:00Z"),
        },
        {
          status: "DOWN",
          responseTimeMs: null,
          checkedAt: new Date("2026-10-09T05:00:00Z"),
        },
        {
          status: "DOWN",
          responseTimeMs: null,
          checkedAt: new Date("2026-10-08T01:00:00Z"),
        },
        {
          status: "DOWN",
          responseTimeMs: null,
          checkedAt: new Date("2026-10-08T04:00:00Z"),
        },
      ];

      const mockIncidents = [
        {
          title: "Outage Incident",
          status: "RESOLVED",
          startedAt: new Date("2026-10-08T00:30:00Z"),
          resolvedAt: new Date("2026-10-08T06:00:00Z"),
          durationSeconds: 19800,
        },
      ];

      (prisma.checkResult.findMany as any).mockResolvedValueOnce(mockChecks);
      (prisma.incident.findMany as any).mockResolvedValueOnce(mockIncidents);

      const calendar = await calculate90DayCalendar("mon-123", refDate);

      // Overall: 3 UP out of 6 total = 50.00%
      expect(calendar.totalChecks).toBe(6);
      expect(calendar.overallUptimePercentage).toBe(50.0);

      // Today (2026-10-10)
      const today = calendar.days.find((d) => d.date === "2026-10-10")!;
      expect(today.status).toBe("OPERATIONAL");
      expect(today.uptimePercentage).toBe(100.0);
      expect(today.totalChecks).toBe(2);
      expect(today.upChecks).toBe(2);
      expect(today.downChecks).toBe(0);
      expect(today.avgResponseTimeMs).toBe(150); // (100 + 200) / 2

      // Yesterday (2026-10-09)
      const yesterday = calendar.days.find((d) => d.date === "2026-10-09")!;
      expect(yesterday.status).toBe("DEGRADED");
      expect(yesterday.uptimePercentage).toBe(50.0);
      expect(yesterday.totalChecks).toBe(2);
      expect(yesterday.upChecks).toBe(1);
      expect(yesterday.downChecks).toBe(1);
      expect(yesterday.avgResponseTimeMs).toBe(150);

      // Two days ago (2026-10-08)
      const twoDaysAgo = calendar.days.find((d) => d.date === "2026-10-08")!;
      expect(twoDaysAgo.status).toBe("OUTAGE");
      expect(twoDaysAgo.uptimePercentage).toBe(0.0);
      expect(twoDaysAgo.totalChecks).toBe(2);
      expect(twoDaysAgo.upChecks).toBe(0);
      expect(twoDaysAgo.downChecks).toBe(2);
      expect(twoDaysAgo.avgResponseTimeMs).toBeNull();
      expect(twoDaysAgo.incidentCount).toBe(1);
      expect(twoDaysAgo.incidents[0].title).toBe("Outage Incident");
    });
  });

  describe("getStatusPageData", () => {
    it("returns null if publicId is missing or empty", async () => {
      expect(await getStatusPageData("")).toBeNull();
      expect(await getStatusPageData("   ")).toBeNull();
    });

    it("returns null if monitor is not found", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce(null);

      const result = await getStatusPageData("pub_nonexistent");
      expect(result).toBeNull();
    });

    it("returns null if monitor exists but isPublic is false (private opt-in protection)", async () => {
      (prisma.monitor.findUnique as any).mockResolvedValueOnce({
        id: "mon-private",
        name: "Private API",
        isPublic: false,
        publicId: "pub_token_private",
        currentStatus: "UP",
        lastCheckedAt: new Date(),
      });

      const result = await getStatusPageData("pub_token_private");
      expect(result).toBeNull();
    });

    it("returns sanitized status page data and strips internal credentials/URLs/IDs when isPublic is true", async () => {
      const now = new Date();
      (prisma.monitor.findUnique as any).mockResolvedValueOnce({
        id: "internal-uuid-secret",
        name: "Public Payments API",
        url: "https://internal-backend.corp.local:8443/private/health?token=secret123",
        isPublic: true,
        publicId: "pub_valid_token_abc",
        currentStatus: "UP",
        lastCheckedAt: now,
      });

      vi.spyOn(analyticsService, "getMonitorAnalytics").mockResolvedValueOnce({
        monitorId: "internal-uuid-secret",
        timestamp: now.toISOString(),
        limitationNotice: "Sample-based uptime methodology notice.",
        windows: {
          last24Hours: {
            windowLabel: "24 Hours",
            totalChecks: 100,
            upChecks: 100,
            downChecks: 0,
            uptimePercentage: 100.0,
            avgResponseTimeMs: 45,
            p95ResponseTimeMs: 50,
            totalIncidents: 0,
            resolvedIncidents: 0,
            meanTimeToResolutionSeconds: null,
          },
          last7Days: {
            windowLabel: "7 Days",
            totalChecks: 700,
            upChecks: 700,
            downChecks: 0,
            uptimePercentage: 100.0,
            avgResponseTimeMs: 44,
            p95ResponseTimeMs: 49,
            totalIncidents: 0,
            resolvedIncidents: 0,
            meanTimeToResolutionSeconds: null,
          },
          last30Days: {
            windowLabel: "30 Days",
            totalChecks: 3000,
            upChecks: 3000,
            downChecks: 0,
            uptimePercentage: 100.0,
            avgResponseTimeMs: 46,
            p95ResponseTimeMs: 52,
            totalIncidents: 0,
            resolvedIncidents: 0,
            meanTimeToResolutionSeconds: null,
          },
        },
        activeIncident: null,
      });

      // Mock checks and incidents for 90-day calendar
      (prisma.checkResult.findMany as any).mockResolvedValueOnce([]);
      (prisma.incident.findMany as any)
        .mockResolvedValueOnce([]) // for calendar
        .mockResolvedValueOnce([
          // for getStatusPageData incident history
          {
            id: "inc-1",
            title: "Temporary Network Latency",
            cause: "Internal stack trace error: Connection pool timeout at 10.0.0.4",
            status: "RESOLVED",
            startedAt: new Date(now.getTime() - 3600000),
            resolvedAt: new Date(now.getTime() - 3000000),
            durationSeconds: 600,
            events: [
              {
                id: "evt-1",
                type: "DETECTED",
                message: "Elevated failure rate detected at 10.0.0.4",
                createdAt: new Date(now.getTime() - 3600000),
              },
              {
                id: "evt-2",
                type: "RESOLVED",
                message: "Service recovered",
                createdAt: new Date(now.getTime() - 3000000),
              },
            ],
          },
        ]);

      const result = await getStatusPageData("pub_valid_token_abc");

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Public Payments API");
      expect(result?.currentStatus).toBe("UP");

      // CRITICAL: publicId MUST NOT be exposed in the response payload body
      expect((result as any).publicId).toBeUndefined();

      // Verify analytics
      expect(result?.analytics.windows.last24Hours.uptimePercentage).toBe(100.0);
      expect(result?.analytics.windows.last24Hours.avgResponseTimeMs).toBe(45);
      expect(result?.analytics.windows.last24Hours.p95ResponseTimeMs).toBe(50);
      expect(result?.analytics.windows.last24Hours.totalChecks).toBe(100);

      // Verify 90-day calendar exists
      expect(result?.calendar).toBeDefined();
      expect(result?.calendar.rangeDays).toBe(90);
      expect(result?.calendar.days).toHaveLength(90);

      // Verify incidents
      expect(result?.activeIncidents).toHaveLength(0);
      expect(result?.resolvedIncidents).toHaveLength(1);
      expect(result?.resolvedIncidents[0].title).toBe("Temporary Network Latency");
      expect(result?.resolvedIncidents[0].durationSeconds).toBe(600);
      expect(result?.resolvedIncidents[0].events).toHaveLength(2);

      // CRITICAL PRIVACY & SECURITY BOUNDARY CHECKS
      const rawJson = JSON.stringify(result);
      expect(rawJson).not.toContain("internal-uuid-secret");
      expect(rawJson).not.toContain("https://internal-backend.corp.local");
      expect(rawJson).not.toContain("secret123");
      expect(rawJson).not.toContain("10.0.0.4");
      expect(rawJson).not.toContain("pub_valid_token_abc"); // token omitted from body
      expect((result as any).url).toBeUndefined();
      expect((result as any).id).toBeUndefined();
    });
  });
});
