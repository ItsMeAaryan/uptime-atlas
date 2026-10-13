import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT: ${url}`);
    (error as any).digest = `NEXT_REDIRECT;replace;${url};307;`;
    (error as any).url = url;
    throw error;
  }),
}));

// Mock auth guard
vi.mock("@/lib/auth/guard", () => ({
  requireOperatorSession: vi.fn(),
}));

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireOperatorSession } from "@/lib/auth/guard";
import Home from "./page";
import LoginPage from "./login/page";
import LoginForm, { submitLoginForm } from "@/components/login-form";
import Dashboard from "@/components/dashboard";

describe("Stage 5.3.3: Authentication Gates & UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Dashboard Route Gate (src/app/page.tsx)", () => {
    it("redirects unauthenticated visitors to /login before rendering dashboard", async () => {
      vi.mocked(requireOperatorSession).mockResolvedValueOnce({
        authenticated: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });

      await expect(Home()).rejects.toThrow("NEXT_REDIRECT: /login");
      expect(redirect).toHaveBeenCalledWith("/login");
    });

    it("renders Dashboard with operator username when authenticated", async () => {
      vi.mocked(requireOperatorSession).mockResolvedValueOnce({
        authenticated: true,
        operator: {
          id: "op-123",
          username: "admin-sec-ops",
        },
      });

      const element = await Home();
      expect(redirect).not.toHaveBeenCalled();
      expect(element).toBeDefined();
      expect(element.type).toBe(Dashboard);
      expect(element.props.operatorUsername).toBe("admin-sec-ops");
    });
  });

  describe("Login Page Gate (src/app/login/page.tsx)", () => {
    it("redirects authenticated operators to /", async () => {
      vi.mocked(requireOperatorSession).mockResolvedValueOnce({
        authenticated: true,
        operator: {
          id: "op-123",
          username: "admin",
        },
      });

      await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT: /");
      expect(redirect).toHaveBeenCalledWith("/");
    });

    it("renders login form when unauthenticated", async () => {
      vi.mocked(requireOperatorSession).mockResolvedValueOnce({
        authenticated: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      });

      const element = await LoginPage();
      expect(redirect).not.toHaveBeenCalled();
      expect(element).toBeDefined();
      const html = renderToString(element);
      expect(html).toContain("Uptime Atlas");
      expect(html).toContain("Sign In");
      expect(html).toContain("username");
      expect(html).toContain("password");
    });
  });

  describe("LoginForm Component (src/components/login-form.tsx)", () => {
    it("renders initial accessible form structure with credentials inputs", () => {
      const html = renderToString(<LoginForm />);
      expect(html).toContain("Uptime Atlas");
      expect(html).toContain('name="username"');
      expect(html).toContain('name="password"');
      expect(html).toContain("Sign In");
      expect(html).toContain("Show password");
      expect(html).toContain("Protected by operator session verification");
    });

    it("submits trimmed username and password with application/json header", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await submitLoginForm(
        { username: "  admin_user  ", password: "Password123!" },
        mockFetch as any
      );

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin_user",
          password: "Password123!",
        }),
      });
    });

    it("handles 429 rate limit with Retry-After header", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "Too many login attempts." }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "45",
          },
        })
      );

      const result = await submitLoginForm(
        { username: "admin", password: "wrong" },
        mockFetch as any
      );

      expect(result.success).toBe(false);
      expect(result.retryAfterSeconds).toBe(45);
      expect(result.error).toContain("45 seconds");
    });

    it("handles 429 rate limit without Retry-After header", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "Too many requests." }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await submitLoginForm(
        { username: "admin", password: "wrong" },
        mockFetch as any
      );

      expect(result.success).toBe(false);
      expect(result.retryAfterSeconds).toBeNull();
      expect(result.error).toBe("Too many requests.");
    });

    it("handles 401 authentication failure with server message", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "Invalid operator credentials." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      const result = await submitLoginForm(
        { username: "admin", password: "wrong" },
        mockFetch as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid operator credentials.");
    });

    it("handles network failure gracefully", async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch"));

      const result = await submitLoginForm(
        { username: "admin", password: "password" },
        mockFetch as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });

  describe("Dashboard Header (src/components/dashboard.tsx)", () => {
    it("renders operator identity badge and logout button", () => {
      const html = renderToString(<Dashboard operatorUsername="super-operator" />);
      expect(html).toContain("super-operator");
      expect(html).toContain("Log out");
      expect(html).toContain("title=\"Authenticated Operator\"");
      expect(html).toContain("title=\"Log out of session\"");
    });

    it("renders fallback operator badge when username is omitted", () => {
      const html = renderToString(<Dashboard />);
      expect(html).toContain("operator");
      expect(html).toContain("Log out");
    });
  });
});
