import net from "node:net";
import { CONFIG } from "../config";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export const IP_LIMIT_MAX_REQUESTS = 10;
export const IP_LIMIT_WINDOW_MS = 60 * 1000; // 60 seconds

export const CRED_LIMIT_MAX_FAILURES = 5;
export const CRED_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const MAX_LIMITER_KEYS = 5000;

interface LimiterEntry {
  timestamps: number[];
  lastAccessed: number;
}

// In-memory state tracking
const ipRequestLimiter = new Map<string, LimiterEntry>();
const failedCredLimiter = new Map<string, LimiterEntry>();

/**
 * Normalizes an IPv4 or IPv6 address string.
 * Strips IPv4-mapped IPv6 prefix (e.g. ::ffff:192.0.2.1 -> 192.0.2.1).
 */
export function normalizeIp(ip: string): string | null {
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed) return null;

  // Handle IPv4-mapped IPv6 addresses (::ffff:192.0.2.1)
  const ipv4MappedMatch = trimmed.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  const candidate = ipv4MappedMatch ? ipv4MappedMatch[1] : trimmed;

  if (net.isIP(candidate) !== 0) {
    return candidate;
  }
  return null;
}

/**
 * Extracts and validates the client IP address from an incoming HTTP request.
 *
 * Security Decision:
 * Forwarded headers (CF-Connecting-IP, X-Forwarded-For, X-Real-IP) are untrusted by default.
 * An attacker can easily spoof these headers to bypass rate limits or target arbitrary IP buckets.
 * They are ONLY inspected when CONFIG.TRUST_PROXY is explicitly enabled.
 * If TRUST_PROXY is disabled or no valid IP header is found, a conservative fallback
 * is returned ("direct-client").
 */
export function getClientIp(request: Request): string {
  if (CONFIG.TRUST_PROXY) {
    // 1. Cloudflare header
    const cfIp = request.headers.get("cf-connecting-ip");
    if (cfIp) {
      const normalized = normalizeIp(cfIp);
      if (normalized) return normalized;
    }

    // 2. X-Real-IP
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      const normalized = normalizeIp(realIp);
      if (normalized) return normalized;
    }

    // 3. X-Forwarded-For (client IP is the first entry)
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const firstIp = forwarded.split(",")[0].trim();
      const normalized = normalizeIp(firstIp);
      if (normalized) return normalized;
    }
  }

  // Conservative fallback for direct connection or untrusted proxies
  return "direct-client";
}

/**
 * Bounds map capacity to prevent memory exhaustion attacks.
 * First sweeps expired entries, then evicts LRU if still at capacity.
 */
function ensureCapacity(map: Map<string, LimiterEntry>, maxCapacity: number, maxWindowMs: number, now: number): void {
  if (map.size < maxCapacity) return;

  // 1. Sweep expired entries across the map
  for (const [key, entry] of map.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => ts > now - maxWindowMs);
    if (entry.timestamps.length === 0) {
      map.delete(key);
    }
  }

  // 2. If still at capacity, evict the least recently accessed key
  if (map.size >= maxCapacity) {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of map.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      map.delete(oldestKey);
    }
  }
}

/**
 * Enforces Limit A: Client IP request limit.
 * Maximum 10 login requests per IP in a rolling 60-second window.
 *
 * Check-and-increment executes synchronously to prevent race conditions.
 */
export function checkIpRateLimit(clientIp: string, now = Date.now()): RateLimitResult {
  const windowStart = now - IP_LIMIT_WINDOW_MS;
  let entry = ipRequestLimiter.get(clientIp);

  if (!entry) {
    ensureCapacity(ipRequestLimiter, MAX_LIMITER_KEYS, IP_LIMIT_WINDOW_MS, now);
    entry = { timestamps: [], lastAccessed: now };
    ipRequestLimiter.set(clientIp, entry);
  }

  entry.lastAccessed = now;
  // Prune timestamps outside rolling window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= IP_LIMIT_MAX_REQUESTS) {
    const oldest = entry.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + IP_LIMIT_WINDOW_MS - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  // Record this attempt
  entry.timestamps.push(now);
  const remaining = IP_LIMIT_MAX_REQUESTS - entry.timestamps.length;

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining,
  };
}

/**
 * Generates the key for Limit B (normalized username + client IP).
 */
function getFailedCredKey(username: string, clientIp: string): string {
  return `failed_cred:${username.trim().toLowerCase()}:${clientIp}`;
}

/**
 * Enforces Limit B: Failed credentials limit.
 * Maximum 5 failed credential attempts for a normalized username + client IP combination within 15 minutes.
 *
 * Note: Does NOT increment the counter. Counter is incremented only when authentication actually fails.
 */
export function checkFailedCredentialsLimit(
  username: string,
  clientIp: string,
  now = Date.now()
): RateLimitResult {
  const key = getFailedCredKey(username, clientIp);
  const windowStart = now - CRED_LIMIT_WINDOW_MS;
  const entry = failedCredLimiter.get(key);

  if (!entry) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: CRED_LIMIT_MAX_FAILURES,
    };
  }

  entry.lastAccessed = now;
  // Prune timestamps outside rolling window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= CRED_LIMIT_MAX_FAILURES) {
    const oldest = entry.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + CRED_LIMIT_WINDOW_MS - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: CRED_LIMIT_MAX_FAILURES - entry.timestamps.length,
  };
}

/**
 * Records a failed credential attempt for (normalized username + client IP).
 */
export function recordFailedCredential(
  username: string,
  clientIp: string,
  now = Date.now()
): void {
  const key = getFailedCredKey(username, clientIp);
  const windowStart = now - CRED_LIMIT_WINDOW_MS;
  let entry = failedCredLimiter.get(key);

  if (!entry) {
    ensureCapacity(failedCredLimiter, MAX_LIMITER_KEYS, CRED_LIMIT_WINDOW_MS, now);
    entry = { timestamps: [], lastAccessed: now };
    failedCredLimiter.set(key, entry);
  }

  entry.lastAccessed = now;
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
  entry.timestamps.push(now);
}

/**
 * Clears the failed-attempt record after a successful login for that same key.
 */
export function clearFailedCredentials(username: string, clientIp: string): void {
  const key = getFailedCredKey(username, clientIp);
  failedCredLimiter.delete(key);
}

/**
 * Resets all in-memory rate limiters (primarily used for test isolation).
 */
export function resetRateLimiters(): void {
  ipRequestLimiter.clear();
  failedCredLimiter.clear();
}

