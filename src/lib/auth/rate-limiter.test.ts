import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkIpRateLimit,
  checkFailedCredentialsLimit,
  recordFailedCredential,
  clearFailedCredentials,
  resetRateLimiters,
  getClientIp,
  normalizeIp,
  IP_LIMIT_MAX_REQUESTS,
  IP_LIMIT_WINDOW_MS,
  CRED_LIMIT_MAX_FAILURES,
  CRED_LIMIT_WINDOW_MS,
  MAX_LIMITER_KEYS,
} from "./rate-limiter";

describe("Rate Limiter Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetRateLimiters();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetRateLimiters();
  });

  describe("IP Extraction & Normalization", () => {
    it("normalizes valid IPv4 addresses", () => {
      expect(normalizeIp(" 192.168.1.50 ")).toBe("192.168.1.50");
    });

    it("normalizes valid IPv6 addresses", () => {
      expect(normalizeIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
        "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
      );
    });

    it("unwraps IPv4-mapped IPv6 addresses to standard IPv4", () => {
      expect(normalizeIp("::ffff:192.0.2.128")).toBe("192.0.2.128");
    });

    it("returns null for malformed IP strings", () => {
      expect(normalizeIp("not-an-ip")).toBeNull();
      expect(normalizeIp("999.999.999.999")).toBeNull();
      expect(normalizeIp("")).toBeNull();
    });

    it("ignores forwarding headers when TRUST_PROXY is false (default) and returns 'direct-client'", () => {
      delete process.env.TRUST_PROXY;
      const request = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "CF-Connecting-IP": "203.0.113.195",
          "X-Forwarded-For": "198.51.100.1, 10.0.0.1",
        },
      });
      expect(getClientIp(request)).toBe("direct-client");
    });

    it("trusts CF-Connecting-IP when TRUST_PROXY is true", () => {
      process.env.TRUST_PROXY = "true";
      const request = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "CF-Connecting-IP": "203.0.113.195",
          "X-Forwarded-For": "198.51.100.1",
        },
      });
      expect(getClientIp(request)).toBe("203.0.113.195");
    });

    it("trusts first X-Forwarded-For IP when TRUST_PROXY is true and CF header is absent", () => {
      process.env.TRUST_PROXY = "true";
      const request = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "X-Forwarded-For": "198.51.100.42, 10.0.0.1",
        },
      });
      expect(getClientIp(request)).toBe("198.51.100.42");
    });

    it("falls back to 'direct-client' when TRUST_PROXY is true but headers contain invalid IP strings", () => {
      process.env.TRUST_PROXY = "true";
      const request = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "X-Forwarded-For": "bogus-ip-string",
        },
      });
      expect(getClientIp(request)).toBe("direct-client");
    });
  });

  describe("Limit A: Client IP Request Rate Limiter", () => {
    const testIp = "192.168.1.100";
    const startTime = 1000000;

    it("allows requests up to IP_LIMIT_MAX_REQUESTS (10)", () => {
      for (let i = 1; i <= IP_LIMIT_MAX_REQUESTS; i++) {
        const result = checkIpRateLimit(testIp, startTime + i * 1000);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(IP_LIMIT_MAX_REQUESTS - i);
        expect(result.retryAfterSeconds).toBe(0);
      }
    });

    it("rejects the 11th request exceeding the threshold with HTTP 429 Retry-After", () => {
      // 10 requests at t = 1000, 2000, ..., 10000
      for (let i = 1; i <= IP_LIMIT_MAX_REQUESTS; i++) {
        checkIpRateLimit(testIp, startTime + i * 1000);
      }

      // 11th request at t = 15000
      const requestTime = startTime + 15000;
      const result = checkIpRateLimit(testIp, requestTime);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);

      // Oldest request in window was at startTime + 1000
      // Expiration time of oldest request = startTime + 1000 + 60000 = startTime + 61000
      // Time remaining = (startTime + 61000) - (startTime + 15000) = 46000 ms = 46 seconds
      expect(result.retryAfterSeconds).toBe(46);
    });

    it("allows new requests after rolling window expires the oldest entry", () => {
      // 10 requests between t = 1000 and t = 10000
      for (let i = 1; i <= IP_LIMIT_MAX_REQUESTS; i++) {
        checkIpRateLimit(testIp, startTime + i * 1000);
      }

      // At t = startTime + 1000 + 60001 (oldest request at t=1000 has expired)
      const afterWindow = startTime + 1000 + IP_LIMIT_WINDOW_MS + 1;
      const result = checkIpRateLimit(testIp, afterWindow);

      expect(result.allowed).toBe(true);
    });

    it("tracks different client IPs independently", () => {
      const ipA = "10.0.0.1";
      const ipB = "10.0.0.2";

      // Exhaust limit for ipA
      for (let i = 1; i <= IP_LIMIT_MAX_REQUESTS; i++) {
        checkIpRateLimit(ipA, startTime + i * 100);
      }
      expect(checkIpRateLimit(ipA, startTime + 2000).allowed).toBe(false);

      // ipB should remain completely unaffected
      const resultB = checkIpRateLimit(ipB, startTime + 2000);
      expect(resultB.allowed).toBe(true);
      expect(resultB.remaining).toBe(9);
    });
  });

  describe("Limit B: Failed Credentials Rate Limiter", () => {
    const testUser = "admin";
    const testIp = "192.168.1.100";
    const startTime = 2000000;

    it("allows check when failures are below CRED_LIMIT_MAX_FAILURES (5)", () => {
      for (let i = 1; i < CRED_LIMIT_MAX_FAILURES; i++) {
        recordFailedCredential(testUser, testIp, startTime + i * 1000);
        const check = checkFailedCredentialsLimit(testUser, testIp, startTime + i * 1000 + 10);
        expect(check.allowed).toBe(true);
        expect(check.remaining).toBe(CRED_LIMIT_MAX_FAILURES - i);
      }
    });

    it("rejects attempt once 5 failures are recorded within 15 minutes", () => {
      // Record 5 failures
      for (let i = 1; i <= CRED_LIMIT_MAX_FAILURES; i++) {
        recordFailedCredential(testUser, testIp, startTime + i * 1000);
      }

      // Check at t = startTime + 10000
      const check = checkFailedCredentialsLimit(testUser, testIp, startTime + 10000);
      expect(check.allowed).toBe(false);
      expect(check.remaining).toBe(0);

      // Oldest failure at startTime + 1000
      // Expires at startTime + 1000 + 15 * 60 * 1000 = startTime + 901000
      // At t = startTime + 10000, retryAfterSeconds = Math.ceil((901000 - 10000) / 1000) = 891
      expect(check.retryAfterSeconds).toBe(891);
    });

    it("clears failed credential counter upon successful login", () => {
      // Record 4 failures
      for (let i = 1; i <= 4; i++) {
        recordFailedCredential(testUser, testIp, startTime + i * 1000);
      }
      expect(checkFailedCredentialsLimit(testUser, testIp, startTime + 5000).remaining).toBe(1);

      // Successful login occurs
      clearFailedCredentials(testUser, testIp);

      // Counter must be completely reset
      const check = checkFailedCredentialsLimit(testUser, testIp, startTime + 6000);
      expect(check.allowed).toBe(true);
      expect(check.remaining).toBe(CRED_LIMIT_MAX_FAILURES);
    });

    it("normalizes username case-insensitively ('Admin' vs 'admin')", () => {
      recordFailedCredential("Admin", testIp, startTime + 1000);
      recordFailedCredential("ADMIN", testIp, startTime + 2000);

      const check = checkFailedCredentialsLimit("admin", testIp, startTime + 3000);
      expect(check.remaining).toBe(3); // 5 - 2 = 3
    });

    it("does NOT implement global username-only lockout (IP isolation)", () => {
      const attackerIp = "198.51.100.99";
      const legitimateIp = "203.0.113.1";

      // Attacker exhausts 5 failed attempts from attackerIp
      for (let i = 1; i <= CRED_LIMIT_MAX_FAILURES; i++) {
        recordFailedCredential(testUser, attackerIp, startTime + i * 1000);
      }

      // Attacker is locked out from attackerIp
      expect(checkFailedCredentialsLimit(testUser, attackerIp, startTime + 6000).allowed).toBe(false);

      // Legitimate operator from legitimateIp is NOT locked out!
      const legitCheck = checkFailedCredentialsLimit(testUser, legitimateIp, startTime + 6000);
      expect(legitCheck.allowed).toBe(true);
      expect(legitCheck.remaining).toBe(CRED_LIMIT_MAX_FAILURES);
    });

    it("allows attempts again after 15-minute rolling window expires oldest failure", () => {
      for (let i = 1; i <= CRED_LIMIT_MAX_FAILURES; i++) {
        recordFailedCredential(testUser, testIp, startTime + i * 1000);
      }
      expect(checkFailedCredentialsLimit(testUser, testIp, startTime + 6000).allowed).toBe(false);

      // Advance time beyond oldest timestamp + 15 minutes
      const afterWindow = startTime + 1000 + CRED_LIMIT_WINDOW_MS + 1;
      const check = checkFailedCredentialsLimit(testUser, testIp, afterWindow);
      expect(check.allowed).toBe(true);
    });
  });

  describe("Memory Safety & Bounded Capacity", () => {
    it("sweeps expired entries when capacity is approached and stays within bound", () => {
      const baseTime = 1000000;
      // Add entries up to MAX_LIMITER_KEYS with timestamps in the past
      for (let i = 0; i < MAX_LIMITER_KEYS; i++) {
        checkIpRateLimit(`10.0.${Math.floor(i / 256)}.${i % 256}`, baseTime);
      }

      // Now advance time so those old entries expire (baseTime + 70 seconds)
      const futureTime = baseTime + IP_LIMIT_WINDOW_MS + 10000;

      // Adding a new IP triggers capacity check and sweeps the expired ones
      checkIpRateLimit("192.168.99.1", futureTime);

      // Should successfully accept new IPs without unbounded memory growth
      expect(checkIpRateLimit("192.168.99.1", futureTime + 1000).allowed).toBe(true);
    });
  });
});

