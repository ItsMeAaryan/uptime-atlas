import crypto from "node:crypto";
import { prisma } from "../prisma";
import { getMonitorAnalytics } from "./analytics-service";

export interface PublicDailyIncidentSummary {
  title: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
}

export interface PublicDailyUptime {
  date: string; // YYYY-MM-DD (UTC)
  status: "OPERATIONAL" | "DEGRADED" | "OUTAGE" | "NO_DATA";
  uptimePercentage: number | null;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  avgResponseTimeMs: number | null;
  incidentCount: number;
  incidents: PublicDailyIncidentSummary[];
}

export interface PublicCalendarData {
  timezone: "UTC";
  rangeDays: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  overallUptimePercentage: number | null;
  totalChecks: number;
  days: PublicDailyUptime[];
}

export interface PublicIncidentEvent {
  type: string;
  message: string;
  createdAt: string;
}

export interface PublicIncident {
  title: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSeconds: number | null;
  events: PublicIncidentEvent[];
}

export interface PublicStatusPageData {
  name: string;
  currentStatus: "UP" | "DOWN" | "PENDING";
  lastCheckedAt: string | null;
  analytics: {
    windows: {
      last24Hours: {
        uptimePercentage: number | null;
        avgResponseTimeMs: number | null;
        p95ResponseTimeMs: number | null;
        totalChecks: number;
      };
      last7Days: {
        uptimePercentage: number | null;
        avgResponseTimeMs: number | null;
        p95ResponseTimeMs: number | null;
        totalChecks: number;
      };
      last30Days: {
        uptimePercentage: number | null;
        avgResponseTimeMs: number | null;
        p95ResponseTimeMs: number | null;
        totalChecks: number;
      };
    };
    limitationNotice: string;
  };
  calendar: PublicCalendarData;
  activeIncidents: PublicIncident[];
  resolvedIncidents: PublicIncident[];
}

/**
 * Generates a non-guessable, URL-safe random public identifier.
 */
export function generatePublicId(): string {
  const token = crypto.randomBytes(16).toString("hex");
  return `pub_${token}`;
}

/**
 * Sanitizes incident event messages for external public display.
 * Strips internal URLs, IP addresses, credentials, and worker diagnostics.
 */
export function sanitizePublicEventMessage(type: string, message: string): string {
  if (type === "DETECTED") {
    return "Automated probe detected service outage.";
  }
  if (type === "RESOLVED") {
    return "Service recovered and operational.";
  }
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted]")
    .replace(/\b(?:token|key|secret|password|bearer|auth)[=:\s]+[^\s,;]+/gi, "[redacted]");
}

/**
 * Updates a monitor's publication status.
 * Generates a publicId if enabling for the first time.
 */
export async function toggleMonitorPublication(
  monitorId: string,
  isPublic: boolean
) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
  });

  if (!monitor) {
    throw new Error(`Monitor with ID "${monitorId}" not found.`);
  }

  let publicId = monitor.publicId;
  if (isPublic && !publicId) {
    publicId = generatePublicId();
  }

  return prisma.monitor.update({
    where: { id: monitorId },
    data: {
      isPublic,
      publicId,
    },
    select: {
      id: true,
      name: true,
      isPublic: true,
      publicId: true,
    },
  });
}

/**
 * Regenerates the publicId for a monitor, invalidating any previously shared URL.
 */
export async function regeneratePublicId(monitorId: string) {
  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
  });

  if (!monitor) {
    throw new Error(`Monitor with ID "${monitorId}" not found.`);
  }

  const newPublicId = generatePublicId();

  return prisma.monitor.update({
    where: { id: monitorId },
    data: {
      publicId: newPublicId,
    },
    select: {
      id: true,
      name: true,
      isPublic: true,
      publicId: true,
    },
  });
}

/**
 * Calculates a 90-day daily uptime calendar strictly using UTC day boundaries.
 * Distinguishes recorded checks from no-data days (never assumes 100% when no checks exist).
 */
export async function calculate90DayCalendar(
  monitorId: string,
  referenceDate: Date = new Date()
): Promise<PublicCalendarData> {
  const rangeDays = 90;

  // Day 0 is today in UTC
  const todayUtc = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );

  // Period start is 89 days before today in UTC at 00:00:00.000Z (total 90 calendar days inclusive)
  const periodStartUtc = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate() - (rangeDays - 1),
      0,
      0,
      0,
      0
    )
  );

  const periodStartStr = periodStartUtc.toISOString().slice(0, 10);
  const periodEndStr = todayUtc.toISOString().slice(0, 10);

  // Fetch all recorded checks in the 90-day period
  const checks = await prisma.checkResult.findMany({
    where: {
      monitorId,
      checkedAt: { gte: periodStartUtc },
    },
    select: {
      status: true,
      responseTimeMs: true,
      checkedAt: true,
    },
    orderBy: { checkedAt: "asc" },
  });

  // Fetch incidents overlapping the 90-day period
  const incidents = await prisma.incident.findMany({
    where: {
      monitorId,
      OR: [
        { startedAt: { gte: periodStartUtc } },
        { resolvedAt: { gte: periodStartUtc } },
        { status: "OPEN" },
      ],
    },
    select: {
      title: true,
      status: true,
      startedAt: true,
      resolvedAt: true,
      durationSeconds: true,
    },
    orderBy: { startedAt: "asc" },
  });

  interface DayAggregate {
    totalChecks: number;
    upChecks: number;
    downChecks: number;
    totalLatency: number;
    latencyCount: number;
  }

  const dayAggMap = new Map<string, DayAggregate>();
  let overallUpChecks = 0;
  let overallTotalChecks = 0;

  for (const check of checks) {
    const dayKey = check.checkedAt.toISOString().slice(0, 10);
    let agg = dayAggMap.get(dayKey);
    if (!agg) {
      agg = {
        totalChecks: 0,
        upChecks: 0,
        downChecks: 0,
        totalLatency: 0,
        latencyCount: 0,
      };
      dayAggMap.set(dayKey, agg);
    }

    agg.totalChecks++;
    overallTotalChecks++;

    if (check.status === "UP") {
      agg.upChecks++;
      overallUpChecks++;
      if (check.responseTimeMs !== null && check.responseTimeMs !== undefined) {
        agg.totalLatency += check.responseTimeMs;
        agg.latencyCount++;
      }
    } else {
      agg.downChecks++;
    }
  }

  const days: PublicDailyUptime[] = [];

  for (let i = rangeDays - 1; i >= 0; i--) {
    const dayDate = new Date(
      Date.UTC(
        todayUtc.getUTCFullYear(),
        todayUtc.getUTCMonth(),
        todayUtc.getUTCDate() - i,
        0,
        0,
        0,
        0
      )
    );
    const dateStr = dayDate.toISOString().slice(0, 10);

    const dayStart = dayDate;
    const dayEnd = new Date(
      Date.UTC(
        dayDate.getUTCFullYear(),
        dayDate.getUTCMonth(),
        dayDate.getUTCDate(),
        23,
        59,
        59,
        999
      )
    );

    // Overlapping incidents for this day
    const dayIncidents: PublicDailyIncidentSummary[] = incidents
      .filter((inc) => {
        const start = inc.startedAt;
        const resolved = inc.resolvedAt;
        if (start > dayEnd) return false;
        if (resolved && resolved < dayStart) return false;
        return true;
      })
      .map((inc) => ({
        title: inc.title,
        startedAt: inc.startedAt.toISOString(),
        resolvedAt: inc.resolvedAt ? inc.resolvedAt.toISOString() : null,
        durationSeconds: inc.durationSeconds,
      }));

    const agg = dayAggMap.get(dateStr);

    if (!agg || agg.totalChecks === 0) {
      days.push({
        date: dateStr,
        status: "NO_DATA",
        uptimePercentage: null,
        totalChecks: 0,
        upChecks: 0,
        downChecks: 0,
        avgResponseTimeMs: null,
        incidentCount: dayIncidents.length,
        incidents: dayIncidents,
      });
      continue;
    }

    const uptimePercentage = Number(
      ((agg.upChecks / agg.totalChecks) * 100).toFixed(2)
    );

    let status: "OPERATIONAL" | "DEGRADED" | "OUTAGE" = "OPERATIONAL";
    if (agg.downChecks > 0 && agg.upChecks === 0) {
      status = "OUTAGE";
    } else if (agg.downChecks > 0) {
      status = "DEGRADED";
    }

    const avgResponseTimeMs =
      agg.latencyCount > 0 ? Math.round(agg.totalLatency / agg.latencyCount) : null;

    days.push({
      date: dateStr,
      status,
      uptimePercentage,
      totalChecks: agg.totalChecks,
      upChecks: agg.upChecks,
      downChecks: agg.downChecks,
      avgResponseTimeMs,
      incidentCount: dayIncidents.length,
      incidents: dayIncidents,
    });
  }

  const overallUptimePercentage =
    overallTotalChecks > 0
      ? Number(((overallUpChecks / overallTotalChecks) * 100).toFixed(2))
      : null;

  return {
    timezone: "UTC",
    rangeDays,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    overallUptimePercentage,
    totalChecks: overallTotalChecks,
    days,
  };
}

/**
 * Retrieves public status page data for a given public token.
 * Returns null if the token does not exist or if the monitor is not published.
 * Strictly sanitizes output: internal database IDs, target URLs, public tokens, and prober diagnostics are excluded.
 */
export async function getStatusPageData(
  publicId: string
): Promise<PublicStatusPageData | null> {
  if (!publicId || typeof publicId !== "string" || !publicId.trim()) {
    return null;
  }

  const monitor = await prisma.monitor.findUnique({
    where: { publicId: publicId.trim() },
    select: {
      id: true,
      name: true,
      isPublic: true,
      publicId: true,
      currentStatus: true,
      lastCheckedAt: true,
    },
  });

  // Opt-in protection: if monitor doesn't exist or is not public, return null (404)
  if (!monitor || !monitor.isPublic || !monitor.publicId) {
    return null;
  }

  // 1. Fetch real analytics from analytics service
  const analytics = await getMonitorAnalytics(monitor.id);

  // 2. Fetch 90-day daily uptime calendar
  const calendar = await calculate90DayCalendar(monitor.id);

  // 3. Fetch incidents (active and recent resolved)
  const incidents = await prisma.incident.findMany({
    where: { monitorId: monitor.id },
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const activeIncidents: PublicIncident[] = incidents
    .filter((inc) => inc.status === "OPEN")
    .map((inc) => ({
      title: inc.title,
      startedAt: inc.startedAt.toISOString(),
      resolvedAt: null,
      durationSeconds: null,
      events: inc.events.map((e) => ({
        type: e.type,
        message: sanitizePublicEventMessage(e.type, e.message),
        createdAt: e.createdAt.toISOString(),
      })),
    }));

  const resolvedIncidents: PublicIncident[] = incidents
    .filter((inc) => inc.status === "RESOLVED")
    .map((inc) => ({
      title: inc.title,
      startedAt: inc.startedAt.toISOString(),
      resolvedAt: inc.resolvedAt ? inc.resolvedAt.toISOString() : null,
      durationSeconds: inc.durationSeconds,
      events: inc.events.map((e) => ({
        type: e.type,
        message: sanitizePublicEventMessage(e.type, e.message),
        createdAt: e.createdAt.toISOString(),
      })),
    }));

  return {
    name: monitor.name,
    currentStatus: monitor.currentStatus as "UP" | "DOWN" | "PENDING",
    lastCheckedAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
    analytics: {
      windows: {
        last24Hours: {
          uptimePercentage: analytics.windows.last24Hours.uptimePercentage,
          avgResponseTimeMs: analytics.windows.last24Hours.avgResponseTimeMs,
          p95ResponseTimeMs: analytics.windows.last24Hours.p95ResponseTimeMs,
          totalChecks: analytics.windows.last24Hours.totalChecks,
        },
        last7Days: {
          uptimePercentage: analytics.windows.last7Days.uptimePercentage,
          avgResponseTimeMs: analytics.windows.last7Days.avgResponseTimeMs,
          p95ResponseTimeMs: analytics.windows.last7Days.p95ResponseTimeMs,
          totalChecks: analytics.windows.last7Days.totalChecks,
        },
        last30Days: {
          uptimePercentage: analytics.windows.last30Days.uptimePercentage,
          avgResponseTimeMs: analytics.windows.last30Days.avgResponseTimeMs,
          p95ResponseTimeMs: analytics.windows.last30Days.p95ResponseTimeMs,
          totalChecks: analytics.windows.last30Days.totalChecks,
        },
      },
      limitationNotice: analytics.limitationNotice,
    },
    calendar,
    activeIncidents,
    resolvedIncidents,
  };
}
