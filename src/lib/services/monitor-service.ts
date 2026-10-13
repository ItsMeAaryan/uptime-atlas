import { prisma } from "../prisma";
import type { ValidatedMonitorData } from "../validation/monitor";
import { performHttpCheck, type HttpCheckOutcome } from "./checker";

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
    },
  });

  return monitors.map((monitor) => {
    const latestCheck = monitor.checkResults[0] || null;
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
        take: 10,
      },
    },
  });
}

export async function recordCheckResult(monitorId: string, outcome: HttpCheckOutcome) {
  return prisma.$transaction(async (tx) => {
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

    // 2. Fetch current consecutive failure count
    const monitor = await tx.monitor.findUniqueOrThrow({
      where: { id: monitorId },
      select: { consecutiveFailures: true },
    });

    const isDown = outcome.status === "DOWN";
    const consecutiveFailures = isDown ? monitor.consecutiveFailures + 1 : 0;

    // 3. Update monitor status and timestamp
    const updatedMonitor = await tx.monitor.update({
      where: { id: monitorId },
      data: {
        currentStatus: outcome.status,
        lastCheckedAt: outcome.checkedAt,
        consecutiveFailures,
      },
    });

    return { checkResult, monitor: updatedMonitor };
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

