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
};
