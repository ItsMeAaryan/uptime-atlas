import { NextResponse } from "next/server";
import { executeAndRecordCheck } from "@/lib/services/monitor-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
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

