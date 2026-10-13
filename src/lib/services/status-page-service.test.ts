import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generatePublicId,
  toggleMonitorPublication,
  regeneratePublicId,
  getStatusPageData,
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

      (prisma.incident.findMany as any).mockResolvedValueOnce([
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
              message: "Elevated failure rate detected",
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
      expect(result?.publicId).toBe("pub_valid_token_abc");

      // Verify analytics
      expect(result?.analytics.windows.last24Hours.uptimePercentage).toBe(100.0);
      expect(result?.analytics.windows.last24Hours.avgResponseTimeMs).toBe(45);
      expect(result?.analytics.windows.last24Hours.p95ResponseTimeMs).toBe(50);
      expect(result?.analytics.windows.last24Hours.totalChecks).toBe(100);

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
      expect((result as any).url).toBeUndefined();
      expect((result as any).id).toBeUndefined();
    });
  });
});
