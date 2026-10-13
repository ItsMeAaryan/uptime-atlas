import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireOperatorSession } from "./guard";
import * as cookiesModule from "./cookies";
import * as sessionModule from "./session";

vi.mock("./cookies");
vi.mock("./session");

describe("requireOperatorSession guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 response immediately when session cookie is missing without querying database", async () => {
    vi.spyOn(cookiesModule, "getSessionTokenFromCookies").mockResolvedValueOnce(null);
    const validateSpy = vi.spyOn(sessionModule, "validateSession");

    const result = await requireOperatorSession();

    expect(result.authenticated).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response?.status).toBe(401);

    const json = await result.response!.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unauthorized");

    // Must NOT execute database validation query
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it("returns 401 response when session token is invalid", async () => {
    vi.spyOn(cookiesModule, "getSessionTokenFromCookies").mockResolvedValueOnce("invalid-token-123");
    vi.spyOn(sessionModule, "validateSession").mockResolvedValueOnce({ isValid: false });

    const result = await requireOperatorSession();

    expect(result.authenticated).toBe(false);
    expect(result.response?.status).toBe(401);

    const json = await result.response!.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unauthorized");
  });

  it("returns 401 response when session has expired", async () => {
    vi.spyOn(cookiesModule, "getSessionTokenFromCookies").mockResolvedValueOnce("expired-token-xyz");
    vi.spyOn(sessionModule, "validateSession").mockResolvedValueOnce({ isValid: false });

    const result = await requireOperatorSession();

    expect(result.authenticated).toBe(false);
    expect(result.response?.status).toBe(401);

    const json = await result.response!.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unauthorized");
  });

  it("returns safe operator details and no response when session is valid", async () => {
    vi.spyOn(cookiesModule, "getSessionTokenFromCookies").mockResolvedValueOnce("valid-active-token");
    vi.spyOn(sessionModule, "validateSession").mockResolvedValueOnce({
      isValid: true,
      operator: {
        id: "operator-uuid-1",
        username: "security_admin",
        createdAt: new Date(),
      },
    });

    const result = await requireOperatorSession();

    expect(result.authenticated).toBe(true);
    expect(result.response).toBeUndefined();
    expect(result.operator).toEqual({
      id: "operator-uuid-1",
      username: "security_admin",
    });

    // Verify sensitive properties are not exposed
    expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).token).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it("returns 401 safely without leaking exception details if validation throws", async () => {
    vi.spyOn(cookiesModule, "getSessionTokenFromCookies").mockRejectedValueOnce(
      new Error("FATAL: connection pool corrupted")
    );

    const result = await requireOperatorSession();

    expect(result.authenticated).toBe(false);
    expect(result.response?.status).toBe(401);

    const json = await result.response!.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Unauthorized");
    expect(JSON.stringify(json)).not.toContain("FATAL");
  });
});

