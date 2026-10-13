import { NextResponse } from "next/server";
import { getStatusPageData } from "@/lib/services/status-page-service";

interface RouteContext {
  params: Promise<{ publicId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { publicId } = await context.params;
    const data = await getStatusPageData(publicId);

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: "Status page not found or not published.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to load public status page" },
      { status: 500 }
    );
  }
}

