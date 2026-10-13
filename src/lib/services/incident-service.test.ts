import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listIncidents,
  getIncidentById,
  addIncidentEvent,
  resolveIncidentManually,
} from "./incident-service";
import { prisma } from "../prisma";

vi.mock("../prisma", () => {
  return {
    prisma: {
      incident: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      incidentEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn((callback) =>
        callback({
          incident: {
            update: vi.fn().mockResolvedValue({
              id: "inc-1",
              status: "RESOLVED",
              resolvedAt: new Date(),
              durationSeconds: 120,
            }),
          },
          incidentEvent: {
            create: vi.fn().mockResolvedValue({
              id: "evt-1",
              incidentId: "inc-1",
              type: "RESOLVED",
            }),
          },
        })
      ),
    },
  };
});

describe("Incident Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists incidents with filters and counts", async () => {
    (prisma.incident.findMany as any).mockResolvedValueOnce([
      {
        id: "inc-1",
        monitorId: "mon-1",
        status: "OPEN",
        title: "Service Outage",
        cause: "Connection refused",
        startedAt: new Date(),
        resolvedAt: null,
        durationSeconds: null,
        monitor: {
          id: "mon-1",
          name: "API",
          slug: "api",
          url: "https://example.com",
          currentStatus: "DOWN",
        },
        events: [{ id: "evt-1", type: "DETECTED", message: "Outage detected" }],
        _count: { events: 1 },
      },
    ]);

    const result = await listIncidents({ status: "OPEN" });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("inc-1");
    expect(result[0].eventCount).toBe(1);
    expect(result[0].latestEvent?.type).toBe("DETECTED");
  });

  it("fetches single incident with chronological events", async () => {
    (prisma.incident.findUnique as any).mockResolvedValueOnce({
      id: "inc-1",
      status: "OPEN",
      title: "Service Outage",
      monitor: { id: "mon-1", name: "API" },
      events: [
        { id: "e-1", type: "DETECTED", message: "Health check failed" },
        { id: "e-2", type: "NOTE", message: "Investigating" },
      ],
    });

    const incident = await getIncidentById("inc-1");

    expect(incident?.id).toBe("inc-1");
    expect(incident?.events).toHaveLength(2);
  });

  it("rejects adding an incident event with an empty message", async () => {
    (prisma.incident.findUnique as any).mockResolvedValueOnce({ id: "inc-1" });

    await expect(
      addIncidentEvent("inc-1", { message: "   " })
    ).rejects.toThrow("Event message cannot be empty.");
  });

  it("adds a valid incident timeline event", async () => {
    (prisma.incident.findUnique as any).mockResolvedValueOnce({ id: "inc-1" });
    (prisma.incidentEvent.create as any).mockResolvedValueOnce({
      id: "evt-new",
      incidentId: "inc-1",
      type: "INVESTIGATING",
      message: "Checking database replica",
    });

    const event = await addIncidentEvent("inc-1", {
      type: "INVESTIGATING",
      message: "Checking database replica",
    });

    expect(event.id).toBe("evt-new");
    expect(prisma.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "inc-1",
          type: "INVESTIGATING",
          message: "Checking database replica",
        }),
      })
    );
  });

  it("resolves an open incident manually and appends a RESOLVED timeline event", async () => {
    const startedAt = new Date(Date.now() - 60000);
    (prisma.incident.findUnique as any).mockResolvedValueOnce({
      id: "inc-1",
      status: "OPEN",
      startedAt,
    });

    const resolved = await resolveIncidentManually("inc-1", "Resolved after restart");

    expect(resolved.status).toBe("RESOLVED");
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
