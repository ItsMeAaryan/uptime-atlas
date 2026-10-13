import { CONFIG } from "../config";

export interface CsrfCheckResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Validates that the request has an explicit, valid application/json Content-Type header.
 *
 * Rules:
 * - Extracts base media type before any parameters (e.g. "; charset=utf-8").
 * - Exactly matches "application/json" (case-insensitive).
 * - Strictly rejects substring tricks like "text/plain; x=application/json".
 * - Strictly rejects form submissions (application/x-www-form-urlencoded, multipart/form-data).
 */
export function validateJsonContentType(request: Request): boolean {
  const rawContentType = request.headers.get("content-type");
  if (!rawContentType) {
    return false;
  }

  // Parse media type according to RFC 9110: type/subtype ; parameter=value
  const mediaType = rawContentType.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Normalizes an origin or URL string to an origin (e.g. "https://example.com:443" -> "https://example.com").
 */
function normalizeOrigin(urlString: string): string | null {
  try {
    const parsed = new URL(urlString);
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Validates that an incoming state-changing request originates from the trusted application origin.
 *
 * Security decisions:
 * 1. Derives the trusted origin strictly from server configuration (CONFIG.APP_URL).
 *    Never trusts arbitrary client-supplied forwarded headers (X-Forwarded-Host, etc.).
 * 2. Checks modern browser Fetch Metadata (Sec-Fetch-Site). If present and "cross-site", immediately rejects.
 * 3. Inspects the Origin header: must exactly match the trusted origin.
 *    (In local development, accepts localhost and 127.0.0.1 equivalents).
 * 4. Fallback for missing Origin:
 *    - Inspects Referer header: its origin must exactly match the trusted origin.
 *    - If both Origin and Referer are absent, checks Sec-Fetch-Site: "same-origin".
 *    - If origin cannot be verified safely, strictly rejects the request.
 */
export function validateCsrfOrigin(request: Request): CsrfCheckResult {
  let trustedOrigin: string;
  try {
    trustedOrigin = CONFIG.APP_URL.toLowerCase();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid server configuration.";
    return { isValid: false, reason: message };
  }

  // Permissible origins for local development convenience
  const allowedOrigins = new Set<string>([trustedOrigin]);
  if (process.env.NODE_ENV !== "production") {
    // In development or test, allow both localhost and 127.0.0.1 on the same port
    try {
      const parsed = new URL(trustedOrigin);
      const portSuffix = parsed.port ? `:${parsed.port}` : "";
      if (parsed.hostname === "localhost") {
        allowedOrigins.add(`${parsed.protocol}//127.0.0.1${portSuffix}`.toLowerCase());
      } else if (parsed.hostname === "127.0.0.1") {
        allowedOrigins.add(`${parsed.protocol}//localhost${portSuffix}`.toLowerCase());
      }
    } catch {
      // Ignore URL parsing errors for fallback
    }
  }

  // 1. Fetch Metadata check (Sec-Fetch-Site)
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return { isValid: false, reason: "Cross-site request rejected by Sec-Fetch-Site metadata." };
  }

  // 2. Origin header validation
  const originHeader = request.headers.get("origin")?.trim();
  if (originHeader) {
    const parsedOrigin = normalizeOrigin(originHeader);
    if (!parsedOrigin || !allowedOrigins.has(parsedOrigin)) {
      return {
        isValid: false,
        reason: `Origin "${originHeader}" does not match trusted application origin.`,
      };
    }
    return { isValid: true };
  }

  // 3. Fallback when Origin is absent: Referer header validation
  const refererHeader = request.headers.get("referer")?.trim();
  if (refererHeader) {
    const parsedRefererOrigin = normalizeOrigin(refererHeader);
    if (!parsedRefererOrigin || !allowedOrigins.has(parsedRefererOrigin)) {
      return {
        isValid: false,
        reason: `Referer "${refererHeader}" does not match trusted application origin.`,
      };
    }
    return { isValid: true };
  }

  // 4. Fallback if both Origin and Referer are absent
  // If Sec-Fetch-Site is explicitly "same-origin", allow it
  if (secFetchSite === "same-origin") {
    return { isValid: true };
  }

  // Otherwise, reject because the origin cannot be verified safely
  return {
    isValid: false,
    reason: "Missing Origin and Referer headers on state-changing request.",
  };
}

