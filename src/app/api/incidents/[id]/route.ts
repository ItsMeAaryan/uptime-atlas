import { NextResponse } from "next/server";
import { getIncidentById, resolveIncidentManually } from "@/lib/services/incident-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const incident = await getIncidentById(id);

    if (!incident) {
      return NextResponse.json(
        { success: false, error: "Incident not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: incident,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch incident", details: message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));

    if (body.status === "RESOLVED") {
      const updated = await resolveIncidentManually(id, body.note);
      return NextResponse.json({
        success: true,
        data: updated,
      });
    }

    return NextResponse.json(
      { success: false, error: "Unsupported patch operation." },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to update incident", details: message },
      { status: 500 }
    );
  }
}
