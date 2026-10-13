import { NextResponse } from "next/server";
import { getMonitorAnalytics } from "@/lib/services/analytics-service";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const monitor = await prisma.monitor.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!monitor) {
      return NextResponse.json(
        { success: false, error: "Monitor not found." },
        { status: 404 }
      );
    }

    const analytics = await getMonitorAnalytics(id);

    return NextResponse.json({
      success: true,
      data: {
        monitor,
        analytics,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to generate analytics", details: message },
      { status: 500 }
    );
  }
}
