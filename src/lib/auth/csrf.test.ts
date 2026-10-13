import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateCsrfOrigin, validateJsonContentType } from "./csrf";

describe("CSRF and Content-Type Security Utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("validateJsonContentType", () => {
    it("accepts exact 'application/json'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      expect(validateJsonContentType(request)).toBe(true);
    });

    it("accepts 'application/json; charset=utf-8' with charset parameter", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
      expect(validateJsonContentType(request)).toBe(true);
    });

    it("accepts case-insensitive 'APPLICATION/JSON'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "APPLICATION/JSON" },
      });
      expect(validateJsonContentType(request)).toBe(true);
    });

    it("rejects missing Content-Type header", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
      });
      expect(validateJsonContentType(request)).toBe(false);
    });

    it("rejects substring attack trick 'text/plain; x=application/json'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "text/plain; x=application/json" },
      });
      expect(validateJsonContentType(request)).toBe(false);
    });

    it("rejects standard form-encoded 'application/x-www-form-urlencoded'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(validateJsonContentType(request)).toBe(false);
    });

    it("rejects multipart form-data 'multipart/form-data; boundary=something'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=something" },
      });
      expect(validateJsonContentType(request)).toBe(false);
    });

    it("rejects text/plain", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
      });
      expect(validateJsonContentType(request)).toBe(false);
    });
  });

  describe("validateCsrfOrigin", () => {
    it("accepts request with matching Origin header", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(true);
    });

    it("rejects request with mismatched Origin header", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://attacker.example.com",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("does not match trusted application origin");
    });

    it("rejects request immediately if Sec-Fetch-Site is 'cross-site' even if Origin seems plausible", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Sec-Fetch-Site": "cross-site",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("Sec-Fetch-Site");
    });

    it("accepts missing Origin if Referer matches trusted application origin", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Referer: "http://localhost:3000/login",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(true);
    });

    it("rejects missing Origin if Referer does not match trusted application origin", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Referer: "http://evil-tracker.example.com/embed",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("does not match trusted application origin");
    });

    it("accepts missing Origin and Referer when Sec-Fetch-Site is 'same-origin'", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(true);
    });

    it("rejects request when both Origin and Referer are absent and no Sec-Fetch-Site is provided", () => {
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("Missing Origin and Referer headers");
    });

    it("supports Cloudflare Tunnel / Reverse Proxy where Origin matches configured APP_URL even if Host is localhost", () => {
      process.env.APP_URL = "https://uptime.example.com";
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Host: "localhost:3000",
          Origin: "https://uptime.example.com",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(true);
    });

    it("rejects mismatched Origin even behind reverse proxy", () => {
      process.env.APP_URL = "https://uptime.example.com";
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          Host: "localhost:3000",
          Origin: "https://phishing.example.com",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(false);
    });

    it("allows 127.0.0.1 in development/test when APP_URL is localhost", () => {
      delete process.env.APP_URL;
      const request = new Request("http://127.0.0.1:3000/api/auth/login", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3000",
        },
      });
      const result = validateCsrfOrigin(request);
      expect(result.isValid).toBe(true);
    });
  });
});

