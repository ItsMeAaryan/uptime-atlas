import { NextResponse } from "next/server";
import {
  toggleMonitorPublication,
  regeneratePublicId,
} from "@/lib/services/status-page-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (body.regenerate) {
      const updated = await regeneratePublicId(id);
      return NextResponse.json({
        success: true,
        data: updated,
      });
    }

    if (typeof body.isPublic === "boolean") {
      const updated = await toggleMonitorPublication(id, body.isPublic);
      return NextResponse.json({
        success: true,
        data: updated,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Invalid request payload. Expected isPublic boolean or regenerate boolean.",
      },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to update publication settings", details: message },
      { status: 500 }
    );
  }
}
