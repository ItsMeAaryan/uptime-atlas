import { describe, it, expect, vi } from "vitest";
import {
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  isPrivateOrReservedIP,
  validateUrlAgainstSSRF,
} from "./ssrf";
import dns from "node:dns/promises";

describe("SSRF Protection - IP Range Rules", () => {
  it("blocks private, loopback, and link-local IPv4 addresses", () => {
    // Loopback
    expect(isPrivateOrReservedIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("127.1.2.3")).toBe(true);

    // Private classes (A, B, C)
    expect(isPrivateOrReservedIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("10.255.255.255")).toBe(true);
    expect(isPrivateOrReservedIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIPv4("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("192.168.0.254")).toBe(true);

    // Link-local / Cloud metadata (AWS/GCP/Azure)
    expect(isPrivateOrReservedIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIPv4("169.254.1.1")).toBe(true);

    // Current network, multicast, reserved
    expect(isPrivateOrReservedIPv4("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedIPv4("224.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("240.0.0.1")).toBe(true);
  });

  it("permits public IPv4 addresses", () => {
    expect(isPrivateOrReservedIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIPv4("93.184.216.34")).toBe(false);
    expect(isPrivateOrReservedIPv4("142.250.190.46")).toBe(false);
  });

  it("blocks private and loopback IPv6 addresses", () => {
    expect(isPrivateOrReservedIPv6("::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("::")).toBe(true);
    expect(isPrivateOrReservedIPv6("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("SSRF Protection - URL & DNS Validation", () => {
  it("rejects non-HTTP/HTTPS protocols", async () => {
    const ftp = await validateUrlAgainstSSRF("ftp://example.com/file");
    expect(ftp.isSafe).toBe(false);
    expect(ftp.reason).toContain("Only HTTP and HTTPS are permitted");

    const file = await validateUrlAgainstSSRF("file:///etc/passwd");
    expect(file.isSafe).toBe(false);
  });

  it("rejects localhost and reserved hostnames without resolving DNS", async () => {
    const localhost = await validateUrlAgainstSSRF("http://localhost:8080");
    expect(localhost.isSafe).toBe(false);
    expect(localhost.reason).toContain("Restricted hostname");

    const localSub = await validateUrlAgainstSSRF("http://app.internal/status");
    expect(localSub.isSafe).toBe(false);
  });

  it("rejects direct IP URLs pointing to private addresses", async () => {
    const loopback = await validateUrlAgainstSSRF("http://127.0.0.1:3000");
    expect(loopback.isSafe).toBe(false);

    const metadata = await validateUrlAgainstSSRF("http://169.254.169.254/latest/meta-data");
    expect(metadata.isSafe).toBe(false);

    const privateIp = await validateUrlAgainstSSRF("http://192.168.1.50/api");
    expect(privateIp.isSafe).toBe(false);
  });

  it("blocks domain names that resolve to private IPs (DNS rebinding prevention)", async () => {
    // Mock DNS lookup resolving to 127.0.0.1
    const lookupSpy = vi.spyOn(dns, "lookup").mockResolvedValueOnce([
      { address: "127.0.0.1", family: 4 },
    ] as any);

    const result = await validateUrlAgainstSSRF("https://evil-rebind.com");
    expect(result.isSafe).toBe(false);
    expect(result.reason).toContain("resolves to a private or restricted IP address");

    lookupSpy.mockRestore();
  });

  it("permits public domains resolving to public IPs", async () => {
    const lookupSpy = vi.spyOn(dns, "lookup").mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
    ] as any);

    const result = await validateUrlAgainstSSRF("https://example.com");
    expect(result.isSafe).toBe(true);

    lookupSpy.mockRestore();
  });
});
