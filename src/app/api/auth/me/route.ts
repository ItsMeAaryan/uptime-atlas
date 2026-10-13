import { NextResponse } from "next/server";
import { validateSession } from "@/lib/auth/session";
import { getSessionTokenFromCookies } from "@/lib/auth/cookies";

export async function GET() {
  try {
    const token = await getSessionTokenFromCookies();

    if (!token) {
      return NextResponse.json({
        success: true,
        data: {
          authenticated: false,
          operator: null,
        },
      });
    }

    const validation = await validateSession(token);

    if (!validation.isValid || !validation.operator) {
      return NextResponse.json({
        success: true,
        data: {
          authenticated: false,
          operator: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        authenticated: true,
        operator: {
          username: validation.operator.username,
        },
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "An unexpected error occurred while checking authentication.",
      },
      { status: 500 }
    );
  }
}

