import { NextResponse } from "next/server";
import { addIncidentEvent } from "@/lib/services/incident-service";
import { requireOperatorSession } from "@/lib/auth/guard";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/auth/csrf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
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

    if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json(
        { success: false, error: "Event message is required." },
        { status: 400 }
      );
    }

    const event = await addIncidentEvent(id, {
      message: body.message,
      type: body.type || "NOTE",
    });

    return NextResponse.json(
      {
        success: true,
        data: event,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to create timeline event", details: message },
      { status: 500 }
    );
  }
}
