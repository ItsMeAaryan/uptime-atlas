import { NextResponse } from "next/server";
import { listIncidents } from "@/lib/services/incident-service";
import { requireOperatorSession } from "@/lib/auth/guard";

export async function GET(request: Request) {
  try {
    const auth = await requireOperatorSession();
    if (!auth.authenticated) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const monitorId = searchParams.get("monitorId") || undefined;
    const limitParam = searchParams.get("limit");

    const status =
      statusParam === "OPEN" || statusParam === "RESOLVED"
        ? statusParam
        : undefined;

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const incidents = await listIncidents({
      status,
      monitorId,
      limit: Number.isNaN(limit) ? undefined : limit,
    });

    return NextResponse.json({
      success: true,
      data: incidents,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to list incidents", details: message },
      { status: 500 }
    );
  }
}
