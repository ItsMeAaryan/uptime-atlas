import { prisma } from "../prisma";

export interface ListIncidentsOptions {
  status?: "OPEN" | "RESOLVED";
  monitorId?: string;
  limit?: number;
}

export async function listIncidents(options: ListIncidentsOptions = {}) {
  const { status, monitorId, limit = 50 } = options;

  const where: {
    status?: "OPEN" | "RESOLVED";
    monitorId?: string;
  } = {};

  if (status) {
    where.status = status;
  }

  if (monitorId) {
    where.monitorId = monitorId;
  }

  const incidents = await prisma.incident.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      monitor: {
        select: {
          id: true,
          name: true,
          slug: true,
          url: true,
          currentStatus: true,
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 1, // latest event for list preview
      },
      _count: {
        select: { events: true },
      },
    },
  });

  return incidents.map((inc) => ({
    id: inc.id,
    monitorId: inc.monitorId,
    status: inc.status,
    title: inc.title,
    cause: inc.cause,
    startedAt: inc.startedAt,
    resolvedAt: inc.resolvedAt,
    durationSeconds: inc.durationSeconds,
    monitor: inc.monitor,
    eventCount: inc._count.events,
    latestEvent: inc.events[0] || null,
  }));
}

export async function getIncidentById(id: string) {
  return prisma.incident.findUnique({
    where: { id },
    include: {
      monitor: {
        select: {
          id: true,
          name: true,
          slug: true,
          url: true,
          currentStatus: true,
        },
      },
      events: {
        orderBy: { createdAt: "asc" }, // chronological timeline
      },
    },
  });
}

export async function addIncidentEvent(
  incidentId: string,
  data: {
    type?: string;
    message: string;
  }
) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!incident) {
    throw new Error(`Incident with ID "${incidentId}" not found.`);
  }

  const trimmedMessage = data.message?.trim();
  if (!trimmedMessage) {
    throw new Error("Event message cannot be empty.");
  }

  return prisma.incidentEvent.create({
    data: {
      incidentId,
      type: (data.type?.trim().toUpperCase()) || "UPDATE",
      message: trimmedMessage,
    },
  });
}

export async function resolveIncidentManually(incidentId: string, note?: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
  });

  if (!incident) {
    throw new Error(`Incident with ID "${incidentId}" not found.`);
  }

  if (incident.status === "RESOLVED") {
    return incident;
  }

  const now = new Date();
  const startedTime = new Date(incident.startedAt).getTime();
  const durationSeconds = Math.max(0, Math.floor((now.getTime() - startedTime) / 1000));

  return prisma.$transaction(async (tx) => {
    const updated = await tx.incident.update({
      where: { id: incidentId },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
        durationSeconds,
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: "RESOLVED",
        message: note?.trim() || "Incident manually marked as resolved by operator.",
        createdAt: now,
      },
    });

    return updated;
  });
}
