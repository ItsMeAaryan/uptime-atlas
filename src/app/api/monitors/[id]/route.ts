import { NextResponse } from "next/server";
import { getMonitorById } from "@/lib/services/monitor-service";
import { prisma } from "@/lib/prisma";
import { requireOperatorSession } from "@/lib/auth/guard";
import { validateCsrfOrigin } from "@/lib/auth/csrf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireOperatorSession();
    if (!auth.authenticated) {
      return auth.response;
    }

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

export async function DELETE(request: Request, context: RouteContext) {
  try {
    // 1. Enforce operator authentication
    const auth = await requireOperatorSession();
    if (!auth.authenticated) {
      return auth.response;
    }

    // 2. Enforce CSRF Origin validation
    const csrfCheck = validateCsrfOrigin(request);
    if (!csrfCheck.isValid) {
      return NextResponse.json(
        { success: false, error: "Cross-origin request rejected." },
        { status: 403 }
      );
    }

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

