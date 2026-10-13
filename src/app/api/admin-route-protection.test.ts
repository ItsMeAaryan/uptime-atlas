import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getMonitors, POST as postMonitors } from "./monitors/route";
import { GET as getMonitorById, DELETE as deleteMonitor } from "./monitors/[id]/route";
import { POST as postCheck } from "./monitors/[id]/check/route";
import { GET as getAnalytics } from "./monitors/[id]/analytics/route";
import { GET as getIncidents } from "./incidents/route";
import { GET as getIncidentById, PATCH as patchIncident } from "./incidents/[id]/route";
import { POST as postIncidentEvent } from "./incidents/[id]/events/route";
import { GET as getPublicStatus } from "./status/[publicId]/route";

import * as guardModule from "@/lib/auth/guard";
import * as monitorService from "@/lib/services/monitor-service";
import * as incidentService from "@/lib/services/incident-service";
import * as analyticsService from "@/lib/services/analytics-service";
import * as statusService from "@/lib/services/status-page-service";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/auth/guard");
vi.mock("@/lib/services/monitor-service");
vi.mock("@/lib/services/incident-service");
vi.mock("@/lib/services/analytics-service");
vi.mock("@/lib/services/status-page-service");
vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitor: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe("Administrative API Route Protection & Security Guards", () => {
  const mockContext = (id = "test-id-123") => ({
    params: Promise.resolve({ id }),
  });

  const unauthMock = {
    authenticated: false as const,
    response: new Response(
      JSON.stringify({ success: false, error: "Unauthorized. Authentication is required to access this resource." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    ) as any,
  };

  const authMock = {
    authenticated: true as const,
    operator: { id: "op-1", username: "admin" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Enforcement (Unauthenticated requests -> 401)", () => {
    beforeEach(() => {
      vi.spyOn(guardModule, "requireOperatorSession").mockResolvedValue(unauthMock);
    });

    it("GET /api/monitors rejects unauthenticated requests with 401", async () => {
      const response = await getMonitors();
      expect(response.status).toBe(401);
      expect(monitorService.listMonitors).not.toHaveBeenCalled();
    });

    it("POST /api/monitors rejects unauthenticated requests with 401 without creating monitor", async () => {
      const request = new Request("http://localhost:3000/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Test", url: "https://example.com" }),
      });
      const response = await postMonitors(request);
      expect(response.status).toBe(401);
      expect(monitorService.createMonitor).not.toHaveBeenCalled();
    });

    it("GET /api/monitors/[id] rejects unauthenticated requests with 401", async () => {
      const request = new Request("http://localhost:3000/api/monitors/test-id-123");
      const response = await getMonitorById(request, mockContext());
      expect(response.status).toBe(401);
      expect(monitorService.getMonitorById).not.toHaveBeenCalled();
    });

    it("DELETE /api/monitors/[id] rejects unauthenticated requests with 401 without deleting monitor", async () => {
      const request = new Request("http://localhost:3000/api/monitors/test-id-123", {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      });
      const response = await deleteMonitor(request, mockContext());
      expect(response.status).toBe(401);
      expect(prisma.monitor.delete).not.toHaveBeenCalled();
    });

    it("POST /api/monitors/[id]/check rejects unauthenticated requests with 401 without executing check", async () => {
      const request = new Request("http://localhost:3000/api/monitors/test-id-123/check", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      });
      const response = await postCheck(request, mockContext());
      expect(response.status).toBe(401);
      expect(monitorService.executeAndRecordCheck).not.toHaveBeenCalled();
    });

    it("GET /api/monitors/[id]/analytics rejects unauthenticated requests with 401", async () => {
      const request = new Request("http://localhost:3000/api/monitors/test-id-123/analytics");
      const response = await getAnalytics(request, mockContext());
      expect(response.status).toBe(401);
      expect(analyticsService.getMonitorAnalytics).not.toHaveBeenCalled();
    });

    it("GET /api/incidents rejects unauthenticated requests with 401", async () => {
      const request = new Request("http://localhost:3000/api/incidents");
      const response = await getIncidents(request);
      expect(response.status).toBe(401);
      expect(incidentService.listIncidents).not.toHaveBeenCalled();
    });

    it("GET /api/incidents/[id] rejects unauthenticated requests with 401", async () => {
      const request = new Request("http://localhost:3000/api/incidents/test-id-123");
      const response = await getIncidentById(request, mockContext());
      expect(response.status).toBe(401);
      expect(incidentService.getIncidentById).not.toHaveBeenCalled();
    });

    it("PATCH /api/incidents/[id] rejects unauthenticated requests with 401 without resolving incident", async () => {
      const request = new Request("http://localhost:3000/api/incidents/test-id-123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ status: "RESOLVED" }),
      });
      const response = await patchIncident(request, mockContext());
      expect(response.status).toBe(401);
      expect(incidentService.resolveIncidentManually).not.toHaveBeenCalled();
    });

    it("POST /api/incidents/[id]/events rejects unauthenticated requests with 401 without creating event", async () => {
      const request = new Request("http://localhost:3000/api/incidents/test-id-123/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ message: "Investigating" }),
      });
      const response = await postIncidentEvent(request, mockContext());
      expect(response.status).toBe(401);
      expect(incidentService.addIncidentEvent).not.toHaveBeenCalled();
    });
  });

  describe("Authenticated Requests & Operation Integrity", () => {
    beforeEach(() => {
      vi.spyOn(guardModule, "requireOperatorSession").mockResolvedValue(authMock);
    });

    it("GET /api/monitors returns 200 with monitors for authenticated operator", async () => {
      vi.spyOn(monitorService, "listMonitors").mockResolvedValueOnce([{ id: "m1", name: "Mon 1" } as any]);
      const response = await getMonitors();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(1);
    });

    it("GET /api/monitors/[id] returns 200 with monitor details for authenticated operator", async () => {
      vi.spyOn(monitorService, "getMonitorById").mockResolvedValueOnce({ id: "m1", name: "Mon 1" } as any);
      const request = new Request("http://localhost:3000/api/monitors/m1");
      const response = await getMonitorById(request, mockContext("m1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe("m1");
    });

    it("DELETE /api/monitors/[id] deletes monitor when authenticated and same-origin", async () => {
      vi.spyOn(prisma.monitor, "delete").mockResolvedValueOnce({ id: "m1" } as any);
      const request = new Request("http://localhost:3000/api/monitors/m1", {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      });
      const response = await deleteMonitor(request, mockContext("m1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(prisma.monitor.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    });

    it("POST /api/monitors/[id]/check triggers manual check when authenticated and same-origin", async () => {
      vi.spyOn(monitorService, "executeAndRecordCheck").mockResolvedValueOnce({
        monitor: { id: "m1", name: "Mon 1" } as any,
        checkResult: { id: "c1", status: "UP" } as any,
      });
      const request = new Request("http://localhost:3000/api/monitors/m1/check", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
      });
      const response = await postCheck(request, mockContext("m1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(monitorService.executeAndRecordCheck).toHaveBeenCalledWith("m1");
    });

    it("GET /api/monitors/[id]/analytics returns analytics for authenticated operator", async () => {
      vi.spyOn(prisma.monitor, "findUnique").mockResolvedValueOnce({ id: "m1", name: "Mon 1" } as any);
      vi.spyOn(analyticsService, "getMonitorAnalytics").mockResolvedValueOnce({
        monitorId: "m1",
        windows: {} as any,
      } as any);
      const request = new Request("http://localhost:3000/api/monitors/m1/analytics");
      const response = await getAnalytics(request, mockContext("m1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("GET /api/incidents returns incidents for authenticated operator", async () => {
      vi.spyOn(incidentService, "listIncidents").mockResolvedValueOnce([]);
      const request = new Request("http://localhost:3000/api/incidents");
      const response = await getIncidents(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("GET /api/incidents/[id] returns incident details for authenticated operator", async () => {
      vi.spyOn(incidentService, "getIncidentById").mockResolvedValueOnce({ id: "inc-1", title: "Outage" } as any);
      const request = new Request("http://localhost:3000/api/incidents/inc-1");
      const response = await getIncidentById(request, mockContext("inc-1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("PATCH /api/incidents/[id] resolves incident when authenticated and same-origin", async () => {
      vi.spyOn(incidentService, "resolveIncidentManually").mockResolvedValueOnce({
        id: "inc-1",
        status: "RESOLVED",
      } as any);
      const request = new Request("http://localhost:3000/api/incidents/inc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ status: "RESOLVED", note: "Fixed server" }),
      });
      const response = await patchIncident(request, mockContext("inc-1"));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("POST /api/incidents/[id]/events creates incident event when authenticated and same-origin", async () => {
      vi.spyOn(incidentService, "addIncidentEvent").mockResolvedValueOnce({
        id: "ev-1",
        message: "Investigating issue",
      } as any);
      const request = new Request("http://localhost:3000/api/incidents/inc-1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ message: "Investigating issue" }),
      });
      const response = await postIncidentEvent(request, mockContext("inc-1"));
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.success).toBe(true);
    });
  });

  describe("CSRF & Content-Type Enforcement on State-Changing Routes", () => {
    beforeEach(() => {
      vi.spyOn(guardModule, "requireOperatorSession").mockResolvedValue(authMock);
    });

    it("POST /api/monitors rejects cross-origin request with 403", async () => {
      const request = new Request("http://localhost:3000/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.com" },
        body: JSON.stringify({ name: "Test" }),
      });
      const response = await postMonitors(request);
      expect(response.status).toBe(403);
    });

    it("POST /api/monitors rejects non-JSON Content-Type with 415", async () => {
      const request = new Request("http://localhost:3000/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://localhost:3000" },
        body: "name=Test",
      });
      const response = await postMonitors(request);
      expect(response.status).toBe(415);
    });

    it("DELETE /api/monitors/[id] rejects cross-origin request with 403", async () => {
      const request = new Request("http://localhost:3000/api/monitors/m1", {
        method: "DELETE",
        headers: { Origin: "http://evil.com" },
      });
      const response = await deleteMonitor(request, mockContext("m1"));
      expect(response.status).toBe(403);
    });

    it("POST /api/monitors/[id]/check rejects cross-origin request with 403", async () => {
      const request = new Request("http://localhost:3000/api/monitors/m1/check", {
        method: "POST",
        headers: { Origin: "http://evil.com" },
      });
      const response = await postCheck(request, mockContext("m1"));
      expect(response.status).toBe(403);
    });

    it("PATCH /api/incidents/[id] rejects non-JSON Content-Type with 415", async () => {
      const request = new Request("http://localhost:3000/api/incidents/inc-1", {
        method: "PATCH",
        headers: { "Content-Type": "text/plain", Origin: "http://localhost:3000" },
        body: "status=RESOLVED",
      });
      const response = await patchIncident(request, mockContext("inc-1"));
      expect(response.status).toBe(415);
    });

    it("POST /api/incidents/[id]/events rejects cross-origin request with 403", async () => {
      const request = new Request("http://localhost:3000/api/incidents/inc-1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.com" },
        body: JSON.stringify({ message: "Hello" }),
      });
      const response = await postIncidentEvent(request, mockContext("inc-1"));
      expect(response.status).toBe(403);
    });
  });

  describe("Public Routes Accessibility (Regression Check)", () => {
    it("GET /api/status/[publicId] remains accessible without operator session (returns 200 or 404, never 401)", async () => {
      // Do not mock operator session (unauthenticated)
      vi.spyOn(statusService, "getStatusPageData").mockResolvedValueOnce({
        name: "Public Monitor",
        currentStatus: "UP",
      } as any);

      const request = new Request("http://localhost:3000/api/status/pub_test_token_123");
      const response = await getPublicStatus(request, {
        params: Promise.resolve({ publicId: "pub_test_token_123" }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe("Public Monitor");
    });
  });
});

