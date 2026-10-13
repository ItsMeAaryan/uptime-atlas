import { NextResponse } from "next/server";
import { validateMonitorInput } from "@/lib/validation/monitor";
import { createMonitor, listMonitors, executeAndRecordCheck } from "@/lib/services/monitor-service";

export async function GET() {
  try {
    const monitors = await listMonitors();
    return NextResponse.json({ success: true, data: monitors });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to retrieve monitors", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON payload in request body." },
        { status: 400 }
      );
    }

    const validation = await validateMonitorInput(body, { checkDns: true });
    if (!validation.isValid || !validation.data) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed.",
          errors: validation.errors,
        },
        { status: 422 }
      );
    }

    const createdMonitor = await createMonitor(validation.data);

    // Perform an initial check immediately so the user doesn't see "PENDING"
    let initialCheck = null;
    try {
      const checkResult = await executeAndRecordCheck(createdMonitor.id);
      initialCheck = checkResult.checkResult;
    } catch (checkErr: unknown) {
      console.warn("Initial check after monitor creation failed:", checkErr);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          ...createdMonitor,
          initialCheck,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, error: "Failed to register monitor", details: message },
      { status: 500 }
    );
  }
}

