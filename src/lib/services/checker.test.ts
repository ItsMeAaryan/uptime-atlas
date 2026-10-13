import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performHttpCheck } from "./checker";
import dns from "node:dns/promises";

describe("HTTP Check Service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Default DNS lookup mock for public IP
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("marks check UP when received status matches expected status code", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      body: { cancel: cancelMock },
    } as any);

    const result = await performHttpCheck({
      url: "https://example.com/api/health",
      expectedStatusCode: 200,
    });

    expect(result.status).toBe("UP");
    expect(result.statusCode).toBe(200);
    expect(result.errorMessage).toBeNull();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(cancelMock).toHaveBeenCalled();
  });

  it("marks check DOWN when received status does not match expected status", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      status: 503,
      statusText: "Service Unavailable",
      body: { cancel: cancelMock },
    } as any);

    const result = await performHttpCheck({
      url: "https://example.com/api/health",
      expectedStatusCode: 200,
    });

    expect(result.status).toBe("DOWN");
    expect(result.statusCode).toBe(503);
    expect(result.errorMessage).toContain("Expected HTTP status 200, but received 503");
  });

  it("handles network connection failures gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("connect ECONNREFUSED 93.184.216.34:443"));

    const result = await performHttpCheck({
      url: "https://example.com",
    });

    expect(result.status).toBe("DOWN");
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("Connection refused by target server");
  });

  it("handles request timeouts gracefully", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValueOnce(abortError);

    const result = await performHttpCheck({
      url: "https://example.com",
      timeoutMs: 1000,
    });

    expect(result.status).toBe("DOWN");
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("Request timed out after 1000ms");
  });

  it("intercepts SSRF targets before issuing any HTTP request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await performHttpCheck({
      url: "http://127.0.0.1:8080/internal",
    });

    expect(result.status).toBe("DOWN");
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("private, loopback, or reserved network range");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
