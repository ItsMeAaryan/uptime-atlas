import { prisma } from "../prisma";
import type { ValidatedMonitorData } from "../validation/monitor";
import { performHttpCheck, type HttpCheckOutcome } from "./checker";
import { CONFIG } from "../config";

export async function createMonitor(data: ValidatedMonitorData) {
  // Ensure slug uniqueness
  let slug = data.slug;
  let counter = 1;
  while (await prisma.monitor.findUnique({ where: { slug } })) {
    slug = `${data.slug}-${counter}`;
    counter++;
  }

  return prisma.monitor.create({
    data: {
      name: data.name,
      slug,
      url: data.url,
      method: data.method,
      intervalSeconds: data.intervalSeconds,
      timeoutMs: data.timeoutMs,
      expectedStatusCode: data.expectedStatusCode,
      isPublic: data.isPublic,
      currentStatus: "PENDING",
    },
  });
}

export async function listMonitors() {
  const monitors = await prisma.monitor.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      checkResults: {
        orderBy: { checkedAt: "desc" },
        take: 1, // Get most recent check result
      },
      incidents: {
        where: { status: "OPEN" },
        take: 1,
      },
    },
  });

  return monitors.map((monitor) => {
    const latestCheck = monitor.checkResults[0] || null;
    const activeIncident = monitor.incidents[0] || null;
    return {
      id: monitor.id,
      name: monitor.name,
      slug: monitor.slug,
      url: monitor.url,
      method: monitor.method,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      expectedStatusCode: monitor.expectedStatusCode,
      isActive: monitor.isActive,
      isPublic: monitor.isPublic,
      currentStatus: monitor.currentStatus,
      consecutiveFailures: monitor.consecutiveFailures,
      lastCheckedAt: monitor.lastCheckedAt,
      createdAt: monitor.createdAt,
      openIncident: activeIncident
        ? {
            id: activeIncident.id,
            title: activeIncident.title,
            cause: activeIncident.cause,
            startedAt: activeIncident.startedAt,
          }
        : null,
      latestCheck: latestCheck
        ? {
            id: latestCheck.id,
            status: latestCheck.status,
            statusCode: latestCheck.statusCode,
            responseTimeMs: latestCheck.responseTimeMs,
            errorMessage: latestCheck.errorMessage,
            checkedAt: latestCheck.checkedAt,
          }
        : null,
    };
  });
}

export async function getMonitorById(id: string) {
  return prisma.monitor.findUnique({
    where: { id },
    include: {
      checkResults: {
        orderBy: { checkedAt: "desc" },
        take: 50,
      },
      incidents: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
          events: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

export async function recordCheckResult(monitorId: string, outcome: HttpCheckOutcome) {
  const threshold = CONFIG.INCIDENT_FAILURE_THRESHOLD;

  return prisma.$transaction(async (tx) => {
    // Acquire row-level lock on monitor in live PostgreSQL if supported to serialize concurrent checks
    if (typeof (tx as any).$executeRaw === "function") {
      try {
        await (tx as any).$executeRaw`SELECT 1 FROM monitors WHERE id = ${monitorId} FOR UPDATE`;
      } catch {
        // Fall back gracefully if mock or unsupported
      }
    }

    // 1. Insert new CheckResult row
    const checkResult = await tx.checkResult.create({
      data: {
        monitorId,
        status: outcome.status,
        statusCode: outcome.statusCode,
        responseTimeMs: outcome.responseTimeMs,
        errorMessage: outcome.errorMessage,
        checkedAt: outcome.checkedAt,
      },
    });

    // 2. Fetch current consecutive failure count and monitor name
    const monitor = await tx.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      select: { id: true, name: true, consecutiveFailures: true },
    });

    const isDown = outcome.status === "DOWN";
    const isUp = outcome.status === "UP";
    const consecutiveFailures = isDown ? monitor.consecutiveFailures + 1 : (isUp ? 0 : monitor.consecutiveFailures);

    let incidentAction: "CREATED" | "RESOLVED" | "NONE" = "NONE";
    let activeIncident: any = null;

    // 3. Incident Lifecycle:
    // Outage threshold reached -> open an incident if none currently OPEN
    if (isDown && consecutiveFailures >= threshold) {
      const existingOpen = await tx.incident.findFirst({
        where: { monitorId, status: "OPEN" },
      });

      if (!existingOpen) {
        try {
          const newIncident = await tx.incident.create({
            data: {
              monitorId,
              status: "OPEN",
              title: `Service Outage: ${monitor.name}`,
              cause: outcome.errorMessage || `Health check failed with HTTP ${outcome.statusCode ?? "error"}`,
              startedAt: outcome.checkedAt,
            },
          });

          await tx.incidentEvent.create({
            data: {
              incidentId: newIncident.id,
              type: "DETECTED",
              message: `Automated probe detected outage (${consecutiveFailures} consecutive failures). Root cause: ${outcome.errorMessage || `HTTP ${outcome.statusCode ?? "error"}`}`,
              createdAt: outcome.checkedAt,
            },
          });

          activeIncident = newIncident;
          incidentAction = "CREATED";
        } catch (err: any) {
          // If unique constraint idx_unique_open_incident triggers under race, retrieve existing
          if (err?.code === "P2002") {
            activeIncident = await tx.incident.findFirst({
              where: { monitorId, status: "OPEN" },
            });
            incidentAction = "NONE";
          } else {
            throw err;
          }
        }
      } else {
        activeIncident = existingOpen;
      }
    } else if (isUp) {
      // Health check recovered -> auto-resolve any currently OPEN incident
      const existingOpen = await tx.incident.findFirst({
        where: { monitorId, status: "OPEN" },
      });

      if (existingOpen) {
        const startedTime = new Date(existingOpen.startedAt).getTime();
        const resolvedTime = outcome.checkedAt.getTime();
        const durationSeconds = Math.max(0, Math.floor((resolvedTime - startedTime) / 1000));

        const resolved = await tx.incident.update({
          where: { id: existingOpen.id },
          data: {
            status: "RESOLVED",
            resolvedAt: outcome.checkedAt,
            durationSeconds,
          },
        });

        await tx.incidentEvent.create({
          data: {
            incidentId: existingOpen.id,
            type: "RESOLVED",
            message: `Service recovered. Endpoint responded with HTTP status ${outcome.statusCode ?? "OK"} (${outcome.responseTimeMs ?? 0}ms).`,
            createdAt: outcome.checkedAt,
          },
        });

        activeIncident = resolved;
        incidentAction = "RESOLVED";
      }
    }

    // 4. Update monitor status, timestamp, and consecutive failure counter
    const updatedMonitor = await tx.monitor.update({
      where: { id: monitorId },
      data: {
        currentStatus: outcome.status,
        lastCheckedAt: outcome.checkedAt,
        consecutiveFailures,
      },
    });

    return {
      checkResult,
      monitor: updatedMonitor,
      incident: activeIncident,
      incidentAction,
    };
  });
}

export async function executeAndRecordCheck(monitorId: string) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
  });

  if (!monitor) {
    throw new Error(`Monitor with ID "${monitorId}" not found.`);
  }

  const outcome = await performHttpCheck({
    url: monitor.url,
    method: monitor.method as "GET" | "HEAD" | "POST",
    timeoutMs: monitor.timeoutMs,
    expectedStatusCode: monitor.expectedStatusCode,
  });

  const { checkResult, monitor: updatedMonitor } = await recordCheckResult(monitorId, outcome);

  return {
    monitor: updatedMonitor,
    checkResult,
  };
}

