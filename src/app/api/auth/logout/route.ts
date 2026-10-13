import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth/session";
import {
  getSessionTokenFromCookies,
  clearSessionCookie,
} from "@/lib/auth/cookies";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/auth/csrf";

export async function POST(request: Request) {
  try {
    // 1. Enforce CSRF Origin validation
    const csrfCheck = validateCsrfOrigin(request);
    if (!csrfCheck.isValid) {
      return NextResponse.json(
        { success: false, error: "Cross-origin request rejected." },
        { status: 403 }
      );
    }

    // 2. Enforce strict Content-Type media type (application/json)
    if (!validateJsonContentType(request)) {
      return NextResponse.json(
        { success: false, error: "Content-Type must be application/json." },
        { status: 415 }
      );
    }

    // 3. Read token from cookie
    const token = await getSessionTokenFromCookies();

    // 4. Revoke session in database if present
    if (token) {
      await deleteSession(token);
    }

    // 5. Clear cookie in browser unconditionally
    await clearSessionCookie();

    return NextResponse.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch {
    // Ensure cookie is cleared even if database operation encounters an issue
    await clearSessionCookie().catch(() => {});

    return NextResponse.json(
      { success: false, error: "An unexpected error occurred during logout." },
      { status: 500 }
    );
  }
}

