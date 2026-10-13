import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../prisma";
import { recordCheckResult } from "./monitor-service";

describe("Incident Lifecycle End-to-End Integration Verification", () => {
  let initialMonitorsSnapshot: {
    id: string;
    name: string;
    url: string;
    currentStatus: string;
    checkResultsCount: number;
    incidentsCount: number;
  }[] = [];

  let testMonitorId: string;
  const testMonitorName = "Lifecycle E2E Verification Monitor";

  beforeAll(async () => {
    // 1. Capture snapshot of pre-existing monitors and checks in PostgreSQL
    const existing = await prisma.monitor.findMany({
      include: {
        _count: {
          select: { checkResults: true, incidents: true },
        },
      },
    });

    initialMonitorsSnapshot = existing.map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      currentStatus: m.currentStatus,
      checkResultsCount: m._count.checkResults,
      incidentsCount: m._count.incidents,
    }));

    // 2. Provision an isolated temporary test monitor
    const temp = await prisma.monitor.create({
      data: {
        name: testMonitorName,
        slug: `lifecycle-e2e-test-${Date.now()}`,
        url: "https://example.com/e2e-verification-endpoint",
        method: "GET",
        currentStatus: "PENDING",
        consecutiveFailures: 0,
      },
    });

    testMonitorId = temp.id;
  });

  afterAll(async () => {
    // Clean up temporary monitor and all its cascade-related records (checks, incidents, events)
    if (testMonitorId) {
      await prisma.monitor.delete({
        where: { id: testMonitorId },
      });
    }

    // Disconnect prisma client
    await prisma.$disconnect();
  });

  it("1. Two consecutive failures do not open an incident with the default threshold of 3", async () => {
    const t1 = new Date();
    const res1 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 503,
      responseTimeMs: 150,
      errorMessage: "Service Unavailable probe 1",
      checkedAt: t1,
    });

    expect(res1.monitor.consecutiveFailures).toBe(1);
    expect(res1.incidentAction).toBe("NONE");
    expect(res1.incident).toBeNull();

    let openIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId, status: "OPEN" },
    });
    expect(openIncidents).toHaveLength(0);

    const t2 = new Date(t1.getTime() + 1000);
    const res2 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 200,
      errorMessage: "Internal Server Error probe 2",
      checkedAt: t2,
    });

    expect(res2.monitor.consecutiveFailures).toBe(2);
    expect(res2.incidentAction).toBe("NONE");
    expect(res2.incident).toBeNull();

    openIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId, status: "OPEN" },
    });
    expect(openIncidents).toHaveLength(0);

    const allIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId },
    });
    expect(allIncidents).toHaveLength(0);
  });

  it("2. The third consecutive failure opens exactly one incident with a DETECTED event", async () => {
    const t3 = new Date(Date.now() + 2000);
    const res3 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 502,
      responseTimeMs: 350,
      errorMessage: "Bad Gateway probe 3",
      checkedAt: t3,
    });

    expect(res3.monitor.consecutiveFailures).toBe(3);
    expect(res3.monitor.currentStatus).toBe("DOWN");
    expect(res3.incidentAction).toBe("CREATED");
    expect(res3.incident).not.toBeNull();

    const openIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId, status: "OPEN" },
      include: { events: true },
    });

    expect(openIncidents).toHaveLength(1);
    const opened = openIncidents[0];
    expect(opened.title).toBe(`Service Outage: ${testMonitorName}`);
    expect(opened.cause).toBe("Bad Gateway probe 3");
    expect(opened.status).toBe("OPEN");
    expect(opened.resolvedAt).toBeNull();
    expect(opened.durationSeconds).toBeNull();

    // Verify timeline event
    expect(opened.events).toHaveLength(1);
    expect(opened.events[0].type).toBe("DETECTED");
    expect(opened.events[0].message).toContain("3 consecutive failures");
    expect(opened.events[0].message).toContain("Bad Gateway probe 3");
  });

  it("3. Additional failures do not create duplicates", async () => {
    const t4 = new Date(Date.now() + 3000);
    const res4 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 504,
      responseTimeMs: 5000,
      errorMessage: "Gateway Timeout probe 4",
      checkedAt: t4,
    });

    expect(res4.monitor.consecutiveFailures).toBe(4);
    expect(res4.incidentAction).toBe("NONE");

    const t5 = new Date(Date.now() + 4000);
    const res5 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 120,
      errorMessage: "Internal Server Error probe 5",
      checkedAt: t5,
    });

    expect(res5.monitor.consecutiveFailures).toBe(5);
    expect(res5.incidentAction).toBe("NONE");

    const allIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId },
      include: { events: true },
    });

    // Still exactly 1 incident in total, and still OPEN
    expect(allIncidents).toHaveLength(1);
    expect(allIncidents[0].status).toBe("OPEN");
  });

  it("4. A successful check resolves the incident and records resolution event and duration", async () => {
    // Recovery check 5 seconds later
    const tRecover = new Date(Date.now() + 8000);
    const resRecover = await recordCheckResult(testMonitorId, {
      status: "UP",
      statusCode: 200,
      responseTimeMs: 38,
      errorMessage: null,
      checkedAt: tRecover,
    });

    expect(resRecover.monitor.consecutiveFailures).toBe(0);
    expect(resRecover.monitor.currentStatus).toBe("UP");
    expect(resRecover.incidentAction).toBe("RESOLVED");
    expect(resRecover.incident).not.toBeNull();

    const openIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId, status: "OPEN" },
    });
    expect(openIncidents).toHaveLength(0);

    const resolvedIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId, status: "RESOLVED" },
      include: {
        events: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    expect(resolvedIncidents).toHaveLength(1);
    const resolved = resolvedIncidents[0];
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.durationSeconds).toBeGreaterThanOrEqual(1);

    // Verify chronological events: DETECTED then RESOLVED
    expect(resolved.events).toHaveLength(2);
    expect(resolved.events[0].type).toBe("DETECTED");
    expect(resolved.events[1].type).toBe("RESOLVED");
    expect(resolved.events[1].message).toContain("Service recovered");
    expect(resolved.events[1].message).toContain("HTTP status 200");
  });

  it("5. A later independent sequence of three failures can create a new incident", async () => {
    // 1st failure of new cycle
    const f1 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 100,
      errorMessage: "Cycle 2 failure 1",
      checkedAt: new Date(Date.now() + 10000),
    });
    expect(f1.monitor.consecutiveFailures).toBe(1);
    expect(f1.incidentAction).toBe("NONE");

    // 2nd failure of new cycle
    const f2 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 500,
      responseTimeMs: 100,
      errorMessage: "Cycle 2 failure 2",
      checkedAt: new Date(Date.now() + 11000),
    });
    expect(f2.monitor.consecutiveFailures).toBe(2);
    expect(f2.incidentAction).toBe("NONE");

    // Still 0 open incidents (only the previous 1 resolved)
    let openCount = await prisma.incident.count({
      where: { monitorId: testMonitorId, status: "OPEN" },
    });
    expect(openCount).toBe(0);

    // 3rd failure of new cycle -> should open a second independent incident!
    const f3 = await recordCheckResult(testMonitorId, {
      status: "DOWN",
      statusCode: 503,
      responseTimeMs: 220,
      errorMessage: "Cycle 2 failure 3 (outage)",
      checkedAt: new Date(Date.now() + 12000),
    });
    expect(f3.monitor.consecutiveFailures).toBe(3);
    expect(f3.incidentAction).toBe("CREATED");

    // Now verify total incidents in DB: exactly 2 (1 RESOLVED from before, 1 OPEN newly created)
    const allIncidents = await prisma.incident.findMany({
      where: { monitorId: testMonitorId },
      orderBy: { startedAt: "asc" },
      include: { events: true },
    });

    expect(allIncidents).toHaveLength(2);
    expect(allIncidents[0].status).toBe("RESOLVED");
    expect(allIncidents[1].status).toBe("OPEN");
    expect(allIncidents[1].cause).toBe("Cycle 2 failure 3 (outage)");

    // The second incident has its own DETECTED event
    expect(allIncidents[1].events).toHaveLength(1);
    expect(allIncidents[1].events[0].type).toBe("DETECTED");
  });

  it("6. Existing monitors and check history remain unchanged by the test", async () => {
    // Fetch all monitors excluding our temporary test monitor
    const currentMonitors = await prisma.monitor.findMany({
      where: {
        id: { not: testMonitorId },
      },
      include: {
        _count: {
          select: { checkResults: true, incidents: true },
        },
      },
    });

    expect(currentMonitors).toHaveLength(initialMonitorsSnapshot.length);

    for (const snap of initialMonitorsSnapshot) {
      const match = currentMonitors.find((m) => m.id === snap.id);
      expect(match).toBeDefined();
      expect(match!.name).toBe(snap.name);
      expect(match!.url).toBe(snap.url);
      expect(match!.currentStatus).toBe(snap.currentStatus);
      expect(match!._count.checkResults).toBe(snap.checkResultsCount);
      expect(match!._count.incidents).toBe(snap.incidentsCount);
    }
  });
});
