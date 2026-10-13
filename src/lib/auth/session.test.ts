import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../prisma";
import { hashPassword } from "./password";
import {
  generateSessionToken,
  hashSessionToken,
  createSession,
  validateSession,
  deleteSession,
  deleteAllOperatorSessions,
  cleanupExpiredSessions,
} from "./session";

describe("Session Management Service", () => {
  const TEST_USERNAME = "test_session_operator";
  const TEST_PASSWORD = "test-session-password-123";
  let testOperatorId: string;

  beforeEach(async () => {
    // Clean up any test operator and sessions
    await prisma.operator.deleteMany({
      where: { username: TEST_USERNAME },
    });

    const passwordHash = await hashPassword(TEST_PASSWORD);
    const operator = await prisma.operator.create({
      data: {
        username: TEST_USERNAME,
        passwordHash,
      },
    });
    testOperatorId = operator.id;
  });

  afterEach(async () => {
    await prisma.operator.deleteMany({
      where: { username: TEST_USERNAME },
    });
  });

  describe("Token Generation & Hashing", () => {
    it("generates unique tokens with at least 32 bytes of entropy", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const token = generateSessionToken();
        expect(token.length).toBeGreaterThanOrEqual(40); // 32 bytes base64url is 43 chars
        expect(tokens.has(token)).toBe(false);
        tokens.add(token);
      }
      expect(tokens.size).toBe(50);
    });

    it("consistently computes SHA-256 hash of a session token", () => {
      const token = "custom-test-token-value-123456789";
      const hash1 = hashSessionToken(token);
      const hash2 = hashSessionToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex is 64 characters
    });
  });

  describe("Database Persistence & Security", () => {
    it("persists only token hash and never plaintext token in PostgreSQL", async () => {
      const { token, session } = await createSession(testOperatorId);

      const dbSession = await prisma.session.findUnique({
        where: { id: session.id },
      });

      expect(dbSession).not.toBeNull();
      // Plaintext token must not equal the stored database tokenHash
      expect(dbSession?.tokenHash).not.toBe(token);
      // The stored tokenHash must strictly equal SHA-256(token)
      expect(dbSession?.tokenHash).toBe(hashSessionToken(token));
    });

    it("successfully validates an active session and returns safe operator details", async () => {
      const { token } = await createSession(testOperatorId);

      const result = await validateSession(token);

      expect(result.isValid).toBe(true);
      expect(result.operator?.id).toBe(testOperatorId);
      expect(result.operator?.username).toBe(TEST_USERNAME);
      // Ensure passwordHash is strictly excluded from returned operator
      expect((result.operator as unknown as Record<string, unknown>)?.passwordHash).toBeUndefined();
    });

    it("rejects non-existent or invalid tokens safely", async () => {
      expect((await validateSession("non-existent-token-abc")).isValid).toBe(false);
      expect((await validateSession("")).isValid).toBe(false);
      expect((await validateSession(null as unknown as string)).isValid).toBe(false);
    });

    it("rejects expired sessions and eagerly removes them from PostgreSQL", async () => {
      // Create session with negative lifetime (already expired in the past)
      const { token, session } = await createSession(testOperatorId, {
        lifetimeSeconds: -10, // 10 seconds ago
      });

      const validation = await validateSession(token);
      expect(validation.isValid).toBe(false);

      // Verify the expired record was deleted
      const checkInDb = await prisma.session.findUnique({
        where: { id: session.id },
      });
      expect(checkInDb).toBeNull();
    });

    it("revokes a session via deleteSession", async () => {
      const { token, session } = await createSession(testOperatorId);

      const deleted = await deleteSession(token);
      expect(deleted).toBe(true);

      // Subsequent validation must fail
      const validation = await validateSession(token);
      expect(validation.isValid).toBe(false);

      // Verify record is gone from DB
      const inDb = await prisma.session.findUnique({ where: { id: session.id } });
      expect(inDb).toBeNull();
    });

    it("handles repeated deletion gracefully without throwing", async () => {
      const { token } = await createSession(testOperatorId);

      expect(await deleteSession(token)).toBe(true);
      // Second deletion attempt on already-deleted session
      expect(await deleteSession(token)).toBe(false);
      expect(await deleteSession("unknown-token")).toBe(false);
      expect(await deleteSession("")).toBe(false);
    });

    it("revokes all sessions for an operator via deleteAllOperatorSessions", async () => {
      await createSession(testOperatorId);
      await createSession(testOperatorId);
      await createSession(testOperatorId);

      const activeCount = await prisma.session.count({ where: { operatorId: testOperatorId } });
      expect(activeCount).toBe(3);

      const deletedCount = await deleteAllOperatorSessions(testOperatorId);
      expect(deletedCount).toBe(3);

      const remaining = await prisma.session.count({ where: { operatorId: testOperatorId } });
      expect(remaining).toBe(0);
    });

    it("cleans up expired sessions via cleanupExpiredSessions", async () => {
      // Directly insert 2 expired sessions in PostgreSQL
      await prisma.session.create({
        data: {
          operatorId: testOperatorId,
          tokenHash: "expired_token_hash_1",
          expiresAt: new Date(Date.now() - 60000), // 1 minute ago
        },
      });
      await prisma.session.create({
        data: {
          operatorId: testOperatorId,
          tokenHash: "expired_token_hash_2",
          expiresAt: new Date(Date.now() - 30000), // 30 seconds ago
        },
      });

      // Insert 1 valid session
      const valid = await prisma.session.create({
        data: {
          operatorId: testOperatorId,
          tokenHash: "valid_token_hash_1",
          expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
        },
      });

      const cleaned = await cleanupExpiredSessions();
      expect(cleaned).toBeGreaterThanOrEqual(2);

      // Valid session must remain intact
      const validInDb = await prisma.session.findUnique({ where: { id: valid.id } });
      expect(validInDb).not.toBeNull();
    });
  });
});
