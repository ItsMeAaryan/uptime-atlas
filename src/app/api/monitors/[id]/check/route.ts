import { NextResponse } from "next/server";
import { executeAndRecordCheck } from "@/lib/services/monitor-service";
import { requireOperatorSession } from "@/lib/auth/guard";
import { validateCsrfOrigin } from "@/lib/auth/csrf";

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

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Monitor ID is required." },
        { status: 400 }
      );
    }

    const { monitor, checkResult } = await executeAndRecordCheck(id);

    return NextResponse.json({
      success: true,
      data: {
        monitor,
        checkResult,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to execute monitor check", details: message },
      { status: 500 }
    );
  }
}

