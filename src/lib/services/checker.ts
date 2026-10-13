import { validateUrlAgainstSSRF } from "../security/ssrf";

export interface HttpCheckTarget {
  url: string;
  method?: "GET" | "HEAD" | "POST";
  timeoutMs?: number;
  expectedStatusCode?: number;
}

export interface HttpCheckOutcome {
  status: "UP" | "DOWN";
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  checkedAt: Date;
}

/**
 * Performs a real HTTP/HTTPS probe against a target endpoint:
 * - Enforces SSRF protection (private/reserved IP & DNS resolution blocking)
 * - Disables redirects to prevent post-hop SSRF bypass
 * - Imposes bounded timeouts (500ms - 30000ms)
 * - Cancels response body stream immediately to avoid downloading unnecessary payloads
 * - Accurately records latency and HTTP status code
 */
export async function performHttpCheck(target: HttpCheckTarget): Promise<HttpCheckOutcome> {
  const checkedAt = new Date();
  const method = target.method || "GET";
  const expectedStatusCode = target.expectedStatusCode || 200;
  // Bound timeout between 500ms and 30000ms (default 5000ms)
  const timeoutMs = Math.min(Math.max(target.timeoutMs ?? 5000, 500), 30000);

  // 1. Pre-flight SSRF and DNS check
  const ssrfCheck = await validateUrlAgainstSSRF(target.url, { resolveDns: true });
  if (!ssrfCheck.isSafe) {
    return {
      status: "DOWN",
      statusCode: null,
      responseTimeMs: null,
      errorMessage: ssrfCheck.reason || "Target URL blocked by SSRF security policy.",
      checkedAt,
    };
  }

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const startTime = performance.now();

  try {
    const response = await fetch(target.url, {
      method,
      redirect: "manual", // Disable automatic redirects to prevent redirection to internal IPs
      signal: controller.signal,
      headers: {
        "User-Agent": "UptimeAtlas/1.0 (+https://uptimeatlas.local; probe)",
        Accept: "*/*",
      },
    });

    const elapsedMs = Math.round(performance.now() - startTime);

    // Bounded body handling: Cancel the body immediately to avoid buffering or downloading large payloads
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // Stream cancel errors are non-critical
      }
    }

    const statusCode = response.status;
    const isSuccess = statusCode === expectedStatusCode;

    return {
      status: isSuccess ? "UP" : "DOWN",
      statusCode,
      responseTimeMs: elapsedMs,
      errorMessage: isSuccess
        ? null
        : `Expected HTTP status ${expectedStatusCode}, but received ${statusCode}.`,
      checkedAt,
    };
  } catch (err: unknown) {
    const elapsedMs = Math.round(performance.now() - startTime);
    let errorMessage = "Network error";

    if (err instanceof Error) {
      if (err.name === "AbortError" || controller.signal.aborted) {
        errorMessage = `Request timed out after ${timeoutMs}ms.`;
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage = "Connection refused by target server.";
      } else if (err.message.includes("ENOTFOUND")) {
        errorMessage = "DNS resolution failed: Domain not found.";
      } else if (err.message.includes("CERT_")) {
        errorMessage = `TLS/SSL Certificate error: ${err.message}.`;
      } else {
        errorMessage = err.message;
      }
    }

    return {
      status: "DOWN",
      statusCode: null,
      responseTimeMs: elapsedMs > 0 ? elapsedMs : null,
      errorMessage,
      checkedAt,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
