import { NextResponse } from "next/server";
import {
  toggleMonitorPublication,
  regeneratePublicId,
} from "@/lib/services/status-page-service";
import { requireOperatorSession } from "@/lib/auth/guard";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/auth/csrf";

interface RouteContext {
  params: Promise<{ id: string }>;
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
    const isNotFound =
      (error instanceof Error && error.message.includes("not found")) ||
      (typeof error === "object" && error !== null && "code" in error && error.code === "P2025");

    if (isNotFound) {
      return NextResponse.json(
        { success: false, error: "Monitor not found", details: message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to update publication settings", details: message },
      { status: 500 }
    );
  }
}


