import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookies";
import { validateCsrfOrigin, validateJsonContentType } from "@/lib/auth/csrf";
import {
  getClientIp,
  checkIpRateLimit,
  checkFailedCredentialsLimit,
  recordFailedCredential,
  clearFailedCredentials,
} from "@/lib/auth/rate-limiter";

/**
 * Static dummy scrypt hash used when an unknown username is supplied.
 * Running verifyPassword against this dummy hash ensures the execution time
 * is virtually identical whether or not the username exists in the database,
 * mitigating user enumeration via timing side-channels.
 */
const DUMMY_SCRYPT_HASH =
  "$scrypt$v=1$N=16384,r=8,p=1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

    // 3. Parse JSON with bounded size
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON payload in request body." },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid request payload. Expected an object." },
        { status: 400 }
      );
    }

    const { username, password } = body as Record<string, unknown>;

    // 4. Validate types and bounds
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return NextResponse.json(
        { success: false, error: "Username and password are required." },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length > 100 || password.length > 256) {
      return NextResponse.json(
        { success: false, error: "Credentials exceed permissible length bounds." },
        { status: 400 }
      );
    }

    // 5. Rate limiting checks before expensive crypto work
    const clientIp = getClientIp(request);

    // 5a. Client IP request rate limit (Limit A: max 10 requests / 60 seconds)
    const ipCheck = checkIpRateLimit(clientIp);
    if (!ipCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many login requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(ipCheck.retryAfterSeconds) },
        }
      );
    }

    // 5b. Failed credential limit (Limit B: max 5 failures / 15 minutes for username + IP)
    const credCheck = checkFailedCredentialsLimit(trimmedUsername, clientIp);
    if (!credCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many failed login attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(credCheck.retryAfterSeconds) },
        }
      );
    }

    // 6. Look up operator
    const operator = await prisma.operator.findUnique({
      where: { username: trimmedUsername },
      select: {
        id: true,
        username: true,
        passwordHash: true,
      },
    });

    let isPasswordValid = false;
    if (operator) {
      isPasswordValid = await verifyPassword(password, operator.passwordHash);
    } else {
      // Execute dummy scrypt verification to equalize timing
      await verifyPassword(password, DUMMY_SCRYPT_HASH);
    }

    // 7. Generic authentication failure response
    if (!operator || !isPasswordValid) {
      // Record failed credential attempt for (username, IP) pair
      recordFailedCredential(trimmedUsername, clientIp);

      return NextResponse.json(
        { success: false, error: "Invalid username or password." },
        { status: 401 }
      );
    }

    // 8. Successful login: clear failed attempts counter
    clearFailedCredentials(trimmedUsername, clientIp);

    // 9. Create database-backed session and set secure httpOnly cookie
    const { token, session } = await createSession(operator.id);
    await setSessionCookie(token, session.expiresAt);

    // 10. Return safe operator details only (never tokens or hashes)
    return NextResponse.json({
      success: true,
      data: {
        operator: {
          username: operator.username,
        },
      },
    });
  } catch {
    // Avoid leaking internal database or server stack details
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}

