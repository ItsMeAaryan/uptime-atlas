import crypto from "node:crypto";
import { prisma } from "../prisma";
import { getMonitorAnalytics } from "./analytics-service";

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
  publicId: string;
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
 * Retrieves public status page data for a given public token.
 * Returns null if the token does not exist or if the monitor is not published.
 * Strictly sanitizes output: internal database IDs, target URLs, and prober diagnostics are excluded.
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

  // 2. Fetch incidents (active and recent resolved)
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
        message: e.message,
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
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
    }));

  return {
    publicId: monitor.publicId,
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
    activeIncidents,
    resolvedIncidents,
  };
}
