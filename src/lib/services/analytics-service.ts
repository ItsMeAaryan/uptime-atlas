import { prisma } from "../prisma";

export interface WindowMetrics {
  windowLabel: string;
  totalChecks: number;
  upChecks: number;
  downChecks: number;
  uptimePercentage: number;
  avgResponseTimeMs: number | null;
  p95ResponseTimeMs: number | null;
  totalIncidents: number;
  resolvedIncidents: number;
  meanTimeToResolutionSeconds: number | null;
}

export interface MonitorAnalytics {
  monitorId: string;
  timestamp: string;
  limitationNotice: string;
  windows: {
    last24Hours: WindowMetrics;
    last7Days: WindowMetrics;
    last30Days: WindowMetrics;
  };
  activeIncident: {
    id: string;
    title: string;
    cause: string | null;
    startedAt: Date;
    durationSecondsSoFar: number;
  } | null;
}

/**
 * Calculates a percentile value (e.g. 95th percentile) from an array of numbers.
 * Uses standard nearest-rank percentile method.
 */
export function calculatePercentile(values: number[], percentile: number): number | null {
  if (!values || values.length === 0) return null;
  if (percentile <= 0) return Math.min(...values);
  if (percentile >= 100) return Math.max(...values);

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
  return sorted[clampedIndex];
}

/**
 * Computes metrics for a specific time window.
 */
function computeWindowMetrics(
  label: string,
  checks: { status: string; responseTimeMs: number | null; checkedAt: Date }[],
  incidents: { startedAt: Date; resolvedAt: Date | null; durationSeconds: number | null }[],
  since: Date
): WindowMetrics {
  const windowChecks = checks.filter((c) => c.checkedAt >= since);
  const windowIncidents = incidents.filter((i) => i.startedAt >= since);

  const totalChecks = windowChecks.length;
  const upChecks = windowChecks.filter((c) => c.status === "UP").length;
  const downChecks = windowChecks.filter((c) => c.status === "DOWN").length;

  const uptimePercentage =
    totalChecks > 0 ? Number(((upChecks / totalChecks) * 100).toFixed(2)) : 100.0;

  const latencies = windowChecks
    .filter((c) => c.status === "UP" && typeof c.responseTimeMs === "number")
    .map((c) => c.responseTimeMs as number);

  const avgResponseTimeMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
      : null;

  const p95ResponseTimeMs = calculatePercentile(latencies, 95);

  const resolved = windowIncidents.filter((i) => i.durationSeconds !== null);
  const meanTimeToResolutionSeconds =
    resolved.length > 0
      ? Math.round(
          resolved.reduce((acc, i) => acc + (i.durationSeconds || 0), 0) / resolved.length
        )
      : null;

  return {
    windowLabel: label,
    totalChecks,
    upChecks,
    downChecks,
    uptimePercentage,
    avgResponseTimeMs,
    p95ResponseTimeMs,
    totalIncidents: windowIncidents.length,
    resolvedIncidents: resolved.length,
    meanTimeToResolutionSeconds,
  };
}

/**
 * Computes 24h, 7d, and 30d reliability analytics for a given monitor from database records.
 */
export async function getMonitorAnalytics(monitorId: string): Promise<MonitorAnalytics> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Fetch all checks in the 30-day window
  const checks = await prisma.checkResult.findMany({
    where: {
      monitorId,
      checkedAt: { gte: thirtyDaysAgo },
    },
    select: {
      status: true,
      responseTimeMs: true,
      checkedAt: true,
    },
    orderBy: { checkedAt: "desc" },
  });

  // Fetch incidents in the 30-day window (and any currently open incident)
  const incidents = await prisma.incident.findMany({
    where: {
      monitorId,
      OR: [{ startedAt: { gte: thirtyDaysAgo } }, { status: "OPEN" }],
    },
    select: {
      id: true,
      title: true,
      cause: true,
      status: true,
      startedAt: true,
      resolvedAt: true,
      durationSeconds: true,
    },
    orderBy: { startedAt: "desc" },
  });

  const openIncident = incidents.find((i) => i.status === "OPEN");
  const activeIncident = openIncident
    ? {
        id: openIncident.id,
        title: openIncident.title,
        cause: openIncident.cause,
        startedAt: openIncident.startedAt,
        durationSecondsSoFar: Math.max(
          0,
          Math.floor((now.getTime() - new Date(openIncident.startedAt).getTime()) / 1000)
        ),
      }
    : null;

  return {
    monitorId,
    timestamp: now.toISOString(),
    limitationNotice:
      "Sample-based uptime computes the ratio of successful discrete probes to total probes executed. It does not measure continuous wall-clock downtime between polling intervals or periods when the monitoring worker was stopped.",
    windows: {
      last24Hours: computeWindowMetrics("24 Hours", checks, incidents, twentyFourHoursAgo),
      last7Days: computeWindowMetrics("7 Days", checks, incidents, sevenDaysAgo),
      last30Days: computeWindowMetrics("30 Days", checks, incidents, thirtyDaysAgo),
    },
    activeIncident,
  };
}
