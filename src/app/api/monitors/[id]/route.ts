import { NextResponse } from "next/server";
import { getMonitorById } from "@/lib/services/monitor-service";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const monitor = await getMonitorById(id);

    if (!monitor) {
      return NextResponse.json(
        { success: false, error: "Monitor not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: monitor });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch monitor", details: message },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await prisma.monitor.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Monitor deleted successfully.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to delete monitor", details: message },
      { status: 500 }
    );
  }
}

