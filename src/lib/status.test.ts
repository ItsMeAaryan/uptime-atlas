import { describe, it, expect } from "vitest";

describe("Uptime Atlas monitoring helpers", () => {
  it("determines health status correctly based on status code", () => {
    const evaluateStatus = (statusCode: number, expectedStatusCode: number = 200) => {
      return statusCode === expectedStatusCode ? "UP" : "DOWN";
    };

    expect(evaluateStatus(200)).toBe("UP");
    expect(evaluateStatus(500)).toBe("DOWN");
    expect(evaluateStatus(404, 404)).toBe("UP");
  });

  it("validates monitor URL scheme", () => {
    const isValidHttpUrl = (urlString: string) => {
      try {
        const url = new URL(urlString);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    };

    expect(isValidHttpUrl("https://example.com")).toBe(true);
    expect(isValidHttpUrl("http://localhost:3000")).toBe(true);
    expect(isValidHttpUrl("ftp://example.com")).toBe(false);
    expect(isValidHttpUrl("invalid-url")).toBe(false);
  });
});
