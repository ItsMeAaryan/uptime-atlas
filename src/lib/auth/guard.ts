import { NextResponse } from "next/server";
import { getSessionTokenFromCookies } from "./cookies";
import { validateSession } from "./session";

export interface SafeOperatorSession {
  id: string;
  username: string;
}

export type OperatorSessionResult =
  | {
      authenticated: true;
      operator: SafeOperatorSession;
      response?: never;
    }
  | {
      authenticated: false;
      operator?: never;
      response: NextResponse;
    };

/**
 * Standard HTTP 401 unauthorized response returned across all administrative endpoints.
 */
function createUnauthorizedResponse(
  message = "Unauthorized. Authentication is required to access this resource."
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status: 401 }
  );
}

/**
 * Verifies that the incoming request has a valid, active operator session.
 *
 * Security & Reliability Decisions:
 * 1. Reads session token via getSessionTokenFromCookies() from the httpOnly cookie.
 * 2. If token is missing, immediately returns HTTP 401 without querying PostgreSQL.
 * 3. Validates token hash and expiration against PostgreSQL via validateSession().
 * 4. Never exposes plaintext session tokens, token hashes, or password hashes.
 * 5. Returns a discriminated union for type-safe handling in Next.js route handlers.
 */
export async function requireOperatorSession(): Promise<OperatorSessionResult> {
  try {
    const token = await getSessionTokenFromCookies();

    if (!token) {
      return {
        authenticated: false,
        response: createUnauthorizedResponse(
          "Unauthorized. Authentication is required to access this resource."
        ),
      };
    }

    const validation = await validateSession(token);

    if (!validation.isValid || !validation.operator) {
      return {
        authenticated: false,
        response: createUnauthorizedResponse(
          "Unauthorized. Session is invalid or has expired."
        ),
      };
    }

    return {
      authenticated: true,
      operator: {
        id: validation.operator.id,
        username: validation.operator.username,
      },
    };
  } catch {
    // Avoid leaking internal errors to unauthenticated callers
    return {
      authenticated: false,
      response: createUnauthorizedResponse(
        "Unauthorized. Authentication is required to access this resource."
      ),
    };
  }
}

