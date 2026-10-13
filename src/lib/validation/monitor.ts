import { validateUrlAgainstSSRF } from "../security/ssrf";

export interface CreateMonitorInput {
  name: string;
  url: string;
  method?: "GET" | "HEAD" | "POST";
  intervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number;
  isPublic?: boolean;
}

export interface ValidatedMonitorData {
  name: string;
  slug: string;
  url: string;
  method: "GET" | "HEAD" | "POST";
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number;
  isPublic: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  data?: ValidatedMonitorData;
}

export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base || "monitor"}-${randomSuffix}`;
}

export async function validateMonitorInput(
  input: unknown,
  options: { checkDns?: boolean } = { checkDns: true }
): Promise<ValidationResult> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== "object") {
    return { isValid: false, errors: { _form: "Invalid request payload. Expected an object." } };
  }

  const payload = input as Record<string, unknown>;

  // 1. Name validation
  let name = "";
  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    errors.name = "Monitor name is required.";
  } else {
    name = payload.name.trim();
    if (name.length < 2) {
      errors.name = "Monitor name must be at least 2 characters long.";
    } else if (name.length > 100) {
      errors.name = "Monitor name cannot exceed 100 characters.";
    }
  }

  // 2. URL & SSRF validation
  let url = "";
  if (typeof payload.url !== "string" || payload.url.trim().length === 0) {
    errors.url = "Target URL is required.";
  } else {
    url = payload.url.trim();
    const ssrfCheck = await validateUrlAgainstSSRF(url, { resolveDns: options.checkDns });
    if (!ssrfCheck.isSafe) {
      errors.url = ssrfCheck.reason || "The provided URL is not allowed.";
    }
  }

  // 3. HTTP Method validation
  let method: "GET" | "HEAD" | "POST" = "GET";
  if (payload.method !== undefined && payload.method !== null) {
    const rawMethod = String(payload.method).toUpperCase();
    if (rawMethod === "GET" || rawMethod === "HEAD" || rawMethod === "POST") {
      method = rawMethod;
    } else {
      errors.method = "HTTP method must be GET, HEAD, or POST.";
    }
  }

  // 4. Interval validation
  let intervalSeconds = 60;
  if (payload.intervalSeconds !== undefined && payload.intervalSeconds !== null) {
    const rawInterval = Number(payload.intervalSeconds);
    if (!Number.isInteger(rawInterval) || rawInterval < 10 || rawInterval > 86400) {
      errors.intervalSeconds = "Interval must be an integer between 10 seconds and 86400 seconds (24 hours).";
    } else {
      intervalSeconds = rawInterval;
    }
  }

  // 5. Timeout validation (bounded to prevent hanging requests)
  let timeoutMs = 5000;
  if (payload.timeoutMs !== undefined && payload.timeoutMs !== null) {
    const rawTimeout = Number(payload.timeoutMs);
    if (!Number.isInteger(rawTimeout) || rawTimeout < 500 || rawTimeout > 30000) {
      errors.timeoutMs = "Timeout must be an integer between 500 ms and 30000 ms (30 seconds).";
    } else {
      timeoutMs = rawTimeout;
    }
  }

  // 6. Expected status code validation
  let expectedStatusCode = 200;
  if (payload.expectedStatusCode !== undefined && payload.expectedStatusCode !== null) {
    const rawStatus = Number(payload.expectedStatusCode);
    if (!Number.isInteger(rawStatus) || rawStatus < 100 || rawStatus > 599) {
      errors.expectedStatusCode = "Expected status code must be a valid HTTP status between 100 and 599.";
    } else {
      expectedStatusCode = rawStatus;
    }
  }

  // 7. Is public flag (opt-in; default false)
  const isPublic = payload.isPublic === undefined ? false : Boolean(payload.isPublic);

  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }

  const slug = generateSlug(name);

  return {
    isValid: true,
    errors: {},
    data: {
      name,
      slug,
      url,
      method,
      intervalSeconds,
      timeoutMs,
      expectedStatusCode,
      isPublic,
    },
  };
}

