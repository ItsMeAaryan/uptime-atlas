import { cookies } from "next/headers";
import { CONFIG } from "../config";

export interface SessionCookieOptions {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
  expires: Date;
  maxAge: number;
}

/**
 * Constructs secure cookie configuration options.
 *
 * Security decisions:
 * - httpOnly: true (prevents XSS attacks from accessing the session token via document.cookie)
 * - sameSite: "lax" (provides default protection against cross-site request forgery while permitting top-level navigations)
 * - path: "/" (applies across the application)
 * - secure: true in production (enforces transmission strictly over HTTPS)
 * - maxAge & expires: synchronized with database session lifetime
 */
export function getSessionCookieOptions(expiresAt: Date): SessionCookieOptions {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    maxAge,
  };
}

/**
 * Sets the secure session cookie in the Next.js App Router response headers.
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    CONFIG.SESSION_COOKIE_NAME,
    token,
    getSessionCookieOptions(expiresAt)
  );
}

/**
 * Retrieves the session token from the incoming Next.js request cookies.
 */
export async function getSessionTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(CONFIG.SESSION_COOKIE_NAME);
  return cookie?.value ? cookie.value.trim() : null;
}

/**
 * Clears the session cookie by deleting it and setting maxAge to 0 with an expired date.
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CONFIG.SESSION_COOKIE_NAME);
  cookieStore.set(CONFIG.SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    maxAge: 0,
  });
}

