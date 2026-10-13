import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { adminFetch, resetRedirectStateForTests } from "./api-client";

describe("adminFetch client helper", () => {
  beforeEach(() => {
    resetRedirectStateForTests();
    // Simulate browser window in Node test environment
    (globalThis as any).window = {
      location: { href: "http://localhost:3000/" },
    };
  });

  afterEach(() => {
    delete (globalThis as any).window;
    vi.restoreAllMocks();
  });

  it("returns response without redirecting when status is 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    const res = await adminFetch("/api/monitors");
    expect(res.status).toBe(200);
    expect((globalThis as any).window.location.href).toBe("http://localhost:3000/");
  });

  it("redirects window.location.href to /login when response status is 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 })
    );

    const res = await adminFetch("/api/monitors");
    expect(res.status).toBe(401);
    expect((globalThis as any).window.location.href).toBe("/login");
  });

  it("does NOT redirect when response status is 403, 404, 429, or 500", async () => {
    for (const status of [403, 404, 429, 500]) {
      resetRedirectStateForTests();
      (globalThis as any).window.location.href = "http://localhost:3000/";

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: `Error ${status}` }), { status })
      );

      const res = await adminFetch("/api/monitors");
      expect(res.status).toBe(status);
      expect((globalThis as any).window.location.href).toBe("http://localhost:3000/");
    }
  });

  it("prevents duplicate redirect assignments on concurrent 401 responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    let assignmentCount = 0;
    const locationTracker = {
      _href: "http://localhost:3000/",
      get href() {
        return this._href;
      },
      set href(val: string) {
        assignmentCount++;
        this._href = val;
      },
    };
    (globalThis as any).window.location = locationTracker;

    await Promise.all([adminFetch("/api/monitors"), adminFetch("/api/incidents")]);

    expect(locationTracker.href).toBe("/login");
    expect(assignmentCount).toBe(1);
  });
});

