import { NextResponse } from "next/server";
import { getIncidentById, resolveIncidentManually } from "@/lib/services/incident-service";
import { requireOperatorSession } from "@/lib/auth/guard";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/auth/csrf";

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

    // 3. Enforce strict JSON Content-Type
    if (!validateJsonContentType(request)) {
      return NextResponse.json(
        { success: false, error: "Content-Type must be application/json." },
        { status: 415 }
      );
    }

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
