import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setSessionCookie,
  getSessionTokenFromCookies,
  clearSessionCookie,
  getSessionCookieOptions,
} from "./cookies";
import { CONFIG } from "../config";

const cookieJar = new Map<string, { value: string; options: unknown }>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { value: cookieJar.get(name)!.value } : undefined,
    set: (name: string, value: string, options: unknown) => {
      cookieJar.set(name, { value, options });
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  })),
}));

describe("Cookie Management Module", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.clearAllMocks();
  });

  describe("getSessionCookieOptions", () => {
    it("returns correct secure cookie attributes", () => {
      const futureDate = new Date(Date.now() + 3600 * 1000);
      const options = getSessionCookieOptions(futureDate);

      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.path).toBe("/");
      expect(options.expires).toEqual(futureDate);
      expect(options.maxAge).toBeGreaterThanOrEqual(3590);
    });
  });

  describe("Cookie read/write/clear lifecycle", () => {
    it("sets session cookie correctly in cookie store", async () => {
      const expiresAt = new Date(Date.now() + 86400 * 1000);
      const token = "secure-random-token-12345";

      await setSessionCookie(token, expiresAt);

      expect(cookieJar.has(CONFIG.SESSION_COOKIE_NAME)).toBe(true);
      const stored = cookieJar.get(CONFIG.SESSION_COOKIE_NAME);
      expect(stored?.value).toBe(token);
    });

    it("retrieves session cookie value when present", async () => {
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, {
        value: "existing-token-value-xyz",
        options: {},
      });

      const token = await getSessionTokenFromCookies();
      expect(token).toBe("existing-token-value-xyz");
    });

    it("returns null when session cookie is not set", async () => {
      const token = await getSessionTokenFromCookies();
      expect(token).toBeNull();
    });

    it("clears session cookie by setting maxAge to 0 and deleting", async () => {
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, {
        value: "token-to-be-cleared",
        options: {},
      });

      await clearSessionCookie();

      // In our mock, delete was called, then set with maxAge: 0
      const stored = cookieJar.get(CONFIG.SESSION_COOKIE_NAME);
      expect(stored?.value).toBe("");
      expect((stored?.options as Record<string, unknown>).maxAge).toBe(0);
    });
  });
});

