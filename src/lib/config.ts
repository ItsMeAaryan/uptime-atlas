/**
 * Application-wide configuration defaults and environment overrides.
 */
export const CONFIG = {
  /**
   * Number of consecutive failed health checks required before automatically opening an incident.
   * Default: 3
   * Override via environment variable: INCIDENT_FAILURE_THRESHOLD
   */
  get INCIDENT_FAILURE_THRESHOLD(): number {
    const raw = process.env.INCIDENT_FAILURE_THRESHOLD;
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 3;
  },
  /**
   * Default session lifetime in seconds (default: 7 days).
   * Override via environment variable: SESSION_LIFETIME_SECONDS
   */
  get SESSION_LIFETIME_SECONDS(): number {
    const raw = process.env.SESSION_LIFETIME_SECONDS;
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 7 * 24 * 60 * 60; // 7 days in seconds (604,800s)
  },

  /**
   * Name of the secure HTTP session cookie.
   */
  SESSION_COOKIE_NAME: "uptime_session",

  /**
   * Trusted public application URL / origin (e.g. "https://uptime.example.com").
   * Validated as an absolute URL.
   * In production, requires HTTPS.
   * In development/test, defaults to "http://localhost:3000".
   */
  get APP_URL(): string {
    const raw = process.env.APP_URL?.trim();
    const isProd = process.env.NODE_ENV === "production";

    if (!raw) {
      if (isProd) {
        throw new Error(
          "APP_URL environment variable is required in production (e.g., https://uptime.example.com)."
        );
      }
      return "http://localhost:3000";
    }

    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`APP_URL must use http: or https: protocol (got "${parsed.protocol}").`);
      }
      if (isProd && parsed.protocol !== "https:") {
        throw new Error("APP_URL must use HTTPS protocol in production.");
      }
      return parsed.origin;
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("APP_URL")) {
        throw err;
      }
      throw new Error(`Invalid APP_URL environment variable ("${raw}"). Must be a valid absolute URL.`);
    }
  },

  /**
   * Whether to trust reverse-proxy headers (e.g. CF-Connecting-IP, X-Forwarded-For, X-Real-IP)
   * for client IP resolution in rate limiting.
   * Default: false (conservative default for direct deployments).
   * Set to true when running behind Cloudflare Tunnel, Nginx, or an upstream proxy
   * that strips client-supplied forwarded headers.
   */
  get TRUST_PROXY(): boolean {
    const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
    return raw === "true" || raw === "1";
  },
};
