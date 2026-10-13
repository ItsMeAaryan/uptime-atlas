/**
 * Client-side API fetch wrapper for administrative requests.
 *
 * If an administrative API endpoint returns HTTP 401 Unauthorized,
 * this helper automatically redirects the browser to /login.
 *
 * Prevents redirect loops and ensures non-401 responses (403, 404, 429, 500)
 * are returned as-is to the caller.
 */
let isRedirecting = false;

export function resetRedirectStateForTests(): void {
  isRedirecting = false;
}

export async function adminFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401) {
    if (typeof window !== "undefined" && !isRedirecting) {
      isRedirecting = true;
      window.location.href = "/login";
    }
  }

  return response;
}

