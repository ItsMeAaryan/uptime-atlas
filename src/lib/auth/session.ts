import crypto from "node:crypto";
import { prisma } from "../prisma";
import { CONFIG } from "../config";

export interface SafeOperator {
  id: string;
  username: string;
  createdAt: Date;
}

export interface SessionData {
  id: string;
  operatorId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SessionValidationResult {
  isValid: boolean;
  operator?: SafeOperator;
  session?: {
    id: string;
    expiresAt: Date;
  };
}

/**
 * Generates a high-entropy cryptographically random session token.
 * Uses 32 random bytes (256 bits of entropy) encoded as URL-safe base64.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Computes the SHA-256 hash of a session token for secure database persistence.
 *
 * Security Decision (OWASP Session Management):
 * Plaintext session tokens must NEVER be stored in the database.
 * If the database is compromised, the attacker cannot impersonate active sessions
 * without finding the preimage of the SHA-256 hash.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a new database-backed session for an operator.
 * Returns the plaintext token (to be sent once in an httpOnly cookie)
 * and the persisted session metadata.
 */
export async function createSession(
  operatorId: string,
  options?: { lifetimeSeconds?: number }
): Promise<{ token: string; session: SessionData }> {
  const lifetime = options?.lifetimeSeconds ?? CONFIG.SESSION_LIFETIME_SECONDS;
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + lifetime * 1000);

  // Opportunistic cleanup of expired sessions to keep database clean
  // without requiring a background scheduler yet (catch any errors silently)
  cleanupExpiredSessions().catch(() => {});

  const session = await prisma.session.create({
    data: {
      operatorId,
      tokenHash,
      expiresAt,
    },
    select: {
      id: true,
      operatorId: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  return {
    token,
    session,
  };
}

/**
 * Validates a session token against PostgreSQL.
 *
 * Checks:
 * 1. Token string is well-formed.
 * 2. SHA-256 hash exists in the Session table.
 * 3. Session has not expired compared to current server time.
 * If expired, it eagerly removes the expired session from the database.
 *
 * Returns safe operator details without leaking password hashes or session tokens.
 */
export async function validateSession(token: unknown): Promise<SessionValidationResult> {
  if (typeof token !== "string" || !token.trim()) {
    return { isValid: false };
  }

  try {
    const tokenHash = hashSessionToken(token.trim());

    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: {
        operator: {
          select: {
            id: true,
            username: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session || !session.operator) {
      return { isValid: false };
    }

    const now = new Date();
    if (session.expiresAt.getTime() <= now.getTime()) {
      // Clean up the expired session eagerly
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return { isValid: false };
    }

    return {
      isValid: true,
      operator: session.operator,
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    };
  } catch {
    return { isValid: false };
  }
}

/**
 * Revokes a session by deleting its corresponding database record.
 * Handles missing or already-deleted sessions gracefully.
 */
export async function deleteSession(token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token.trim()) {
    return false;
  }

  try {
    const tokenHash = hashSessionToken(token.trim());
    const result = await prisma.session.deleteMany({
      where: { tokenHash },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

/**
 * Revokes all active sessions for a specific operator (e.g. on password change).
 */
export async function deleteAllOperatorSessions(operatorId: string): Promise<number> {
  try {
    const result = await prisma.session.deleteMany({
      where: { operatorId },
    });
    return result.count;
  } catch {
    return 0;
  }
}

/**
 * Cleans up expired sessions from PostgreSQL.
 * Can be called opportunistically or via maintenance utilities.
 */
export async function cleanupExpiredSessions(
  referenceDate: Date = new Date()
): Promise<number> {
  try {
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: referenceDate },
      },
    });
    return result.count;
  } catch {
    return 0;
  }
}
