import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import * as statusService from "@/lib/services/status-page-service";

vi.mock("@/lib/services/status-page-service");

describe("GET /api/status/[publicId] route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with sanitized data for published monitor (omitting publicId from body)", async () => {
    const mockData: any = {
      name: "Public Service",
      currentStatus: "UP" as const,
      lastCheckedAt: new Date().toISOString(),
      analytics: {
        windows: {
          last24Hours: { uptimePercentage: 100, avgResponseTimeMs: 120, p95ResponseTimeMs: 150, totalChecks: 10 },
          last7Days: { uptimePercentage: 100, avgResponseTimeMs: 120, p95ResponseTimeMs: 150, totalChecks: 50 },
          last30Days: { uptimePercentage: 100, avgResponseTimeMs: 120, p95ResponseTimeMs: 150, totalChecks: 200 },
        },
        limitationNotice: "Notice",
      },
      calendar: {
        timezone: "UTC",
        rangeDays: 90,
        periodStart: "2026-07-13",
        periodEnd: "2026-10-10",
        overallUptimePercentage: 100,
        totalChecks: 200,
        days: [],
      },
      activeIncidents: [],
      resolvedIncidents: [],
    };

    vi.spyOn(statusService, "getStatusPageData").mockResolvedValueOnce(mockData);

    const request = new Request("http://localhost:3000/api/status/pub_12345678901234567890123456789012");
    const response = await GET(request, {
      params: Promise.resolve({ publicId: "pub_12345678901234567890123456789012" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("Public Service");
    expect(json.data.publicId).toBeUndefined(); // strictly omitted from body
  });

  it("returns 404 when status page does not exist or is unpublished", async () => {
    vi.spyOn(statusService, "getStatusPageData").mockResolvedValueOnce(null);

    const request = new Request("http://localhost:3000/api/status/pub_missing_or_private");
    const response = await GET(request, {
      params: Promise.resolve({ publicId: "pub_missing_or_private" }),
    });

    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Status page not found or not published.");
  });

  it("returns generic 500 without leaking server stack trace or internal error details", async () => {
    vi.spyOn(statusService, "getStatusPageData").mockRejectedValueOnce(
      new Error("FATAL: connection to database failed on postgresql://internal-host:5432")
    );

    const request = new Request("http://localhost:3000/api/status/pub_valid_token");
    const response = await GET(request, {
      params: Promise.resolve({ publicId: "pub_valid_token" }),
    });

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Failed to load public status page");
    expect(json.details).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("internal-host");
    expect(JSON.stringify(json)).not.toContain("FATAL");
  });
});
