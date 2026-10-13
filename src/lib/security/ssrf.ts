import dns from "node:dns/promises";
import net from "node:net";

/**
 * Checks whether an IPv4 address is in private, loopback, link-local, or reserved ranges.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8: Current network ("this" network)
  if (a === 0) return true;

  // 10.0.0.0/8: Private network
  if (a === 10) return true;

  // 127.0.0.0/8: Loopback (localhost)
  if (a === 127) return true;

  // 100.64.0.0/10: Shared Address Space (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 169.254.0.0/16: Link-local (includes AWS/GCP metadata at 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12: Private network (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24: IETF Protocol Assignments
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24: Documentation (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16: Private network
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15: Network benchmark tests
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24: Documentation (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24: Documentation (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4: Multicast
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4: Reserved / future use
  if (a >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is loopback, unique-local, link-local, or IPv4-mapped private.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 / :: loopback and unspecified
  if (normalized === "::1" || normalized === "::") return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateOrReservedIPv4(ipv4Part);
    }
  }

  // fc00::/7: Unique Local Address (ULA)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // fe80::/10: Link-local address
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if a given IP address (v4 or v6) is private or reserved.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true; // Not a valid IP -> treat as unsafe
}

export interface UrlSecurityCheckResult {
  isSafe: boolean;
  reason?: string;
  resolvedIps?: string[];
}

/**
 * Validates a target URL against SSRF threats:
 * 1. Checks HTTP/HTTPS scheme only.
 * 2. Blocks known dangerous hostnames (localhost, *.local, etc.).
 * 3. Resolves DNS and checks all returned IP addresses.
 */
export async function validateUrlAgainstSSRF(
  urlString: string,
  options: { resolveDns?: boolean } = { resolveDns: true }
): Promise<UrlSecurityCheckResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return { isSafe: false, reason: "Malformed URL" };
  }

  // 1. Only allow HTTP and HTTPS protocols
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      isSafe: false,
      reason: `Unsupported protocol: "${parsedUrl.protocol}". Only HTTP and HTTPS are permitted.`,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 2. Reject explicit localhost or special-use domain names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home")
  ) {
    return {
      isSafe: false,
      reason: `Restricted hostname: "${hostname}" cannot be monitored.`,
    };
  }

  // 3. If hostname is directly an IP literal, validate immediately
  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        isSafe: false,
        reason: `Target IP address "${hostname}" belongs to a private, loopback, or reserved network range.`,
        resolvedIps: [hostname],
      };
    }
    return { isSafe: true, resolvedIps: [hostname] };
  }

  // 4. DNS resolution check (if enabled)
  if (options.resolveDns) {
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return { isSafe: false, reason: `Could not resolve domain name "${hostname}".` };
      }

      const ips = records.map((r) => r.address);
      for (const ip of ips) {
        if (isPrivateOrReservedIP(ip)) {
          return {
            isSafe: false,
            reason: `Domain "${hostname}" resolves to a private or restricted IP address (${ip}).`,
            resolvedIps: ips,
          };
        }
      }

      return { isSafe: true, resolvedIps: ips };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "DNS resolution failed";
      return { isSafe: false, reason: `DNS resolution failed for "${hostname}": ${message}` };
    }
  }

  return { isSafe: true };
}
