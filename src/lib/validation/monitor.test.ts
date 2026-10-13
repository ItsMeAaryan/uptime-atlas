import { describe, it, expect } from "vitest";
import { validateMonitorInput, generateSlug } from "./monitor";

describe("Monitor Validation", () => {
  it("generates clean slugs from monitor names", () => {
    const slug1 = generateSlug("My Production API");
    expect(slug1).toMatch(/^my-production-api-[a-z0-9]{4}$/);

    const slug2 = generateSlug("  Test --- Endpoint!  ");
    expect(slug2).toMatch(/^test-endpoint-[a-z0-9]{4}$/);
  });

  it("validates valid input payload successfully", async () => {
    const validPayload = {
      name: "Acme Production Web",
      url: "https://example.com/health",
      method: "GET",
      intervalSeconds: 60,
      timeoutMs: 5000,
      expectedStatusCode: 200,
      isPublic: true,
    };

    const result = await validateMonitorInput(validPayload, { checkDns: false });
    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe("Acme Production Web");
    expect(result.data?.method).toBe("GET");
    expect(result.data?.expectedStatusCode).toBe(200);
  });

  it("rejects invalid or missing names", async () => {
    const missing = await validateMonitorInput({ url: "https://example.com" }, { checkDns: false });
    expect(missing.isValid).toBe(false);
    expect(missing.errors.name).toContain("name is required");

    const tooShort = await validateMonitorInput(
      { name: "A", url: "https://example.com" },
      { checkDns: false }
    );
    expect(tooShort.isValid).toBe(false);
    expect(tooShort.errors.name).toContain("at least 2 characters");
  });

  it("rejects invalid URLs and SSRF targets", async () => {
    const badUrl = await validateMonitorInput(
      { name: "Internal", url: "not-a-url" },
      { checkDns: false }
    );
    expect(badUrl.isValid).toBe(false);
    expect(badUrl.errors.url).toBeDefined();

    const loopback = await validateMonitorInput(
      { name: "Local Host", url: "http://localhost:3000" },
      { checkDns: false }
    );
    expect(loopback.isValid).toBe(false);
    expect(loopback.errors.url).toContain("Restricted hostname");
  });

  it("enforces timeout bounds between 500ms and 30000ms", async () => {
    const tooLow = await validateMonitorInput(
      { name: "Fast", url: "https://example.com", timeoutMs: 100 },
      { checkDns: false }
    );
    expect(tooLow.isValid).toBe(false);
    expect(tooLow.errors.timeoutMs).toContain("between 500 ms and 30000 ms");

    const tooHigh = await validateMonitorInput(
      { name: "Slow", url: "https://example.com", timeoutMs: 60000 },
      { checkDns: false }
    );
    expect(tooHigh.isValid).toBe(false);
    expect(tooHigh.errors.timeoutMs).toContain("between 500 ms and 30000 ms");
  });

  it("enforces HTTP expected status code ranges (100-599)", async () => {
    const invalidStatus = await validateMonitorInput(
      { name: "Invalid", url: "https://example.com", expectedStatusCode: 999 },
      { checkDns: false }
    );
    expect(invalidStatus.isValid).toBe(false);
    expect(invalidStatus.errors.expectedStatusCode).toContain("between 100 and 599");
  });

  it("defaults isPublic to false when omitted (opt-in publication)", async () => {
    const omitted = await validateMonitorInput(
      { name: "Private Web", url: "https://example.com" },
      { checkDns: false }
    );
    expect(omitted.isValid).toBe(true);
    expect(omitted.data?.isPublic).toBe(false);

    const explicitlyPublic = await validateMonitorInput(
      { name: "Public Web", url: "https://example.com", isPublic: true },
      { checkDns: false }
    );
    expect(explicitlyPublic.isValid).toBe(true);
    expect(explicitlyPublic.data?.isPublic).toBe(true);
  });
});

