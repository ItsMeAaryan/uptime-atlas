import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as handleLogin } from "./login/route";
import { POST as handleLogout } from "./logout/route";
import { GET as handleMe } from "./me/route";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { CONFIG } from "@/lib/config";
import { resetRateLimiters } from "@/lib/auth/rate-limiter";

// In-memory cookie store mock simulating Next.js 16 await cookies()
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

describe("Authentication API Endpoints (/api/auth/*)", () => {
  const TEST_USERNAME = "api_test_operator";
  const TEST_PASSWORD = "super-secret-operator-pass-123";
  let testOperatorId: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    resetRateLimiters();
    cookieJar.clear();
    // Clean up test operator
    await prisma.operator.deleteMany({
      where: { username: TEST_USERNAME },
    });

    const passwordHash = await hashPassword(TEST_PASSWORD);
    const operator = await prisma.operator.create({
      data: {
        username: TEST_USERNAME,
        passwordHash,
      },
    });
    testOperatorId = operator.id;
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetRateLimiters();
    cookieJar.clear();
    await prisma.operator.deleteMany({
      where: { username: TEST_USERNAME },
    });
  });

  describe("POST /api/auth/login", () => {
    it("successfully logs in with valid credentials, sets cookie, and returns safe operator info (without operator id)", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.operator.username).toBe(TEST_USERNAME);

      // Finding 4: Verify operator.id is strictly excluded
      expect(json.data.operator.id).toBeUndefined();

      // Verify no sensitive fields leaked in JSON
      expect(json.data.token).toBeUndefined();
      expect(json.data.sessionToken).toBeUndefined();
      expect(json.data.operator.passwordHash).toBeUndefined();

      // Verify session cookie was set in cookie store
      expect(cookieJar.has(CONFIG.SESSION_COOKIE_NAME)).toBe(true);
      const cookieVal = cookieJar.get(CONFIG.SESSION_COOKIE_NAME)?.value;
      expect(typeof cookieVal).toBe("string");
      expect(cookieVal?.length).toBeGreaterThan(30);

      // Verify session exists in PostgreSQL
      const dbSessions = await prisma.session.findMany({
        where: { operatorId: testOperatorId },
      });
      expect(dbSessions.length).toBe(1);
    });

    it("accepts Content-Type with charset parameter (application/json; charset=utf-8)", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("rejects incorrect password with generic 401 error message", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: "wrong-password-9999",
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid username or password.");
      expect(cookieJar.has(CONFIG.SESSION_COOKIE_NAME)).toBe(false);
    });

    it("rejects unknown username with identical generic 401 error message", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          username: "nonexistent_operator_xyz",
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid username or password.");
      expect(cookieJar.has(CONFIG.SESSION_COOKIE_NAME)).toBe(false);
    });

    it("rejects malformed JSON payload with 400", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: "{ invalid-json",
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Malformed JSON");
    });

    it("rejects missing username or password with 400", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ username: TEST_USERNAME }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("required");
    });

    it("rejects form-encoded Content-Type with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
        },
        body: `username=${TEST_USERNAME}&password=${TEST_PASSWORD}`,
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(415);
      const json = await response.json();
      expect(json.error).toContain("application/json");
    });

    it("rejects multipart/form-data Content-Type with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=test",
          Origin: "http://localhost:3000",
        },
        body: "test-content",
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(415);
    });

    it("rejects substring attack trick 'text/plain; x=application/json' with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; x=application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(415);
    });

    it("rejects cross-origin request when Origin header does not match with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://malicious-site.example.com",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(403);
    });

    it("rejects request when Sec-Fetch-Site is 'cross-site' with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(403);
    });

    it("accepts missing Origin when Referer is same-origin", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: "http://localhost:3000/login",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(200);
    });

    it("rejects missing Origin when Referer is cross-origin with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: "http://malicious-site.example.com/login",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(403);
    });

    it("rejects missing Origin and missing Referer with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(403);
    });

    it("accepts request behind reverse proxy / Cloudflare Tunnel when Origin matches APP_URL even if Host differs", async () => {
      process.env.APP_URL = "https://uptime.example.com";

      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://uptime.example.com",
          Host: "localhost:3000",
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const response = await handleLogin(request);
      expect(response.status).toBe(200);
    });

    it("returns 429 and Retry-After header when client IP request limit (10) is exceeded", async () => {
      // Execute 10 requests with different usernames from the same client IP
      // (ensuring Limit B's 5-failure threshold per username is not tripped)
      for (let i = 0; i < 10; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            username: `unregistered_user_${i}`,
            password: "wrong-password",
          }),
        });
        const res = await handleLogin(req);
        expect(res.status).toBe(401); // Within limit, rejected on credentials
      }

      // 11th request from same IP exceeds IP limit (Limit A)
      const rateLimitedReq = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          username: "unregistered_user_11",
          password: "any-password",
        }),
      });

      const response = await handleLogin(rateLimitedReq);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBeDefined();

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Too many login requests");

      // Verify no session cookie set
      expect(cookieJar.has(CONFIG.SESSION_COOKIE_NAME)).toBe(false);
    });

    it("returns 429 and Retry-After header when failed credential limit (5) is exceeded", async () => {
      process.env.TRUST_PROXY = "true";
      const testIp = "198.51.100.55";

      // 5 failed credential attempts from testIp
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            username: TEST_USERNAME,
            password: "bad-password-attempt",
          }),
        });
        const res = await handleLogin(req);
        expect(res.status).toBe(401);
      }

      // 6th attempt with matching username + IP is blocked before crypto verification
      const blockedReq = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD, // Even with correct password, blocked by failed-cred limit
        }),
      });

      const response = await handleLogin(blockedReq);
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBeDefined();

      const json = await response.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain("Too many failed login attempts");
    });

    it("clears failed credential counter upon successful login", async () => {
      process.env.TRUST_PROXY = "true";
      const testIp = "198.51.100.77";

      // 3 failed credential attempts
      for (let i = 0; i < 3; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            username: TEST_USERNAME,
            password: "wrong-password",
          }),
        });
        const res = await handleLogin(req);
        expect(res.status).toBe(401);
      }

      // Successful login from same testIp
      const successReq = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const successRes = await handleLogin(successReq);
      expect(successRes.status).toBe(200);

      // Now 3 more failed attempts should not trigger 429 because counter was reset
      for (let i = 0; i < 3; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            username: TEST_USERNAME,
            password: "wrong-password",
          }),
        });
        const res = await handleLogin(req);
        expect(res.status).toBe(401); // 401, not 429
      }
    });

    it("requests rejected by CSRF or Content-Type do not consume failed credential attempts", async () => {
      process.env.TRUST_PROXY = "true";
      const testIp = "198.51.100.88";

      // 5 requests rejected by Content-Type (415)
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            Origin: "http://localhost:3000",
            "X-Forwarded-For": testIp,
          },
          body: "not-json",
        });
        const res = await handleLogin(req);
        expect(res.status).toBe(415);
      }

      // Legitimate attempt should succeed with 200 (not 429)
      const validReq = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        }),
      });

      const validRes = await handleLogin(validReq);
      expect(validRes.status).toBe(200);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("successfully logs out, revokes session from database, and clears cookie", async () => {
      // 1. Create active session
      const { token, session } = await createSession(testOperatorId);
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, { value: token, options: {} });

      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);

      // Verify cookie cleared
      const stored = cookieJar.get(CONFIG.SESSION_COOKIE_NAME);
      expect(stored?.value).toBe("");

      // Verify database record revoked
      const inDb = await prisma.session.findUnique({ where: { id: session.id } });
      expect(inDb).toBeNull();
    });

    it("accepts logout with Content-Type 'application/json; charset=utf-8'", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Origin: "http://localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("rejects logout when Content-Type header is missing with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(415);
      const json = await response.json();
      expect(json.error).toContain("application/json");
    });

    it("rejects logout with form-encoded Content-Type with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "http://localhost:3000",
        },
        body: "action=logout",
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(415);
    });

    it("rejects logout with substring trick 'text/plain; x=application/json' with 415", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; x=application/json",
          Origin: "http://localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(415);
    });

    it("rejects logout with cross-origin Origin with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://attacker.example.com",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(403);
    });

    it("rejects logout with Sec-Fetch-Site: cross-site with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "Sec-Fetch-Site": "cross-site",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(403);
    });

    it("accepts logout with missing Origin when Referer is same-origin", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: "http://localhost:3000/dashboard",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);
    });

    it("rejects logout with missing Origin and missing Referer with 403", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(403);
    });

    it("handles logout gracefully when cookie is missing", async () => {
      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("handles logout gracefully when session was already revoked", async () => {
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, {
        value: "already-revoked-token-12345",
        options: {},
      });

      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
    });

    it("accepts logout behind reverse proxy / Cloudflare Tunnel when Origin matches APP_URL even if Host differs", async () => {
      process.env.APP_URL = "https://uptime.example.com";

      const request = new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://uptime.example.com",
          Host: "localhost:3000",
        },
      });

      const response = await handleLogout(request);
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns authenticated: true and operator username for a valid active session", async () => {
      const { token } = await createSession(testOperatorId);
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, { value: token, options: {} });

      const response = await handleMe();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.authenticated).toBe(true);
      expect(json.data.operator.username).toBe(TEST_USERNAME);

      // Verify sensitive details excluded
      expect(json.data.token).toBeUndefined();
      expect(json.data.operator.passwordHash).toBeUndefined();
      expect(json.data.operator.id).toBeUndefined();
    });

    it("returns authenticated: false when session cookie is missing", async () => {
      const response = await handleMe();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.authenticated).toBe(false);
      expect(json.data.operator).toBeNull();
    });

    it("returns authenticated: false when session cookie is invalid", async () => {
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, {
        value: "invalid-token-does-not-exist",
        options: {},
      });

      const response = await handleMe();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.authenticated).toBe(false);
      expect(json.data.operator).toBeNull();
    });

    it("returns authenticated: false when session has expired", async () => {
      const { token } = await createSession(testOperatorId, {
        lifetimeSeconds: -10, // expired
      });
      cookieJar.set(CONFIG.SESSION_COOKIE_NAME, { value: token, options: {} });

      const response = await handleMe();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.data.authenticated).toBe(false);
      expect(json.data.operator).toBeNull();
    });
  });
});
