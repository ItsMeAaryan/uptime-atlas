import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  MIN_PASSWORD_LENGTH,
  SCRYPT_CONFIG,
} from "./password";

describe("Password Security Module", () => {
  describe("validatePasswordStrength", () => {
    it("accepts valid passwords meeting minimum length", () => {
      const result = validatePasswordStrength("a-secure-pass-123");
      expect(result.isValid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects empty password", () => {
      const result = validatePasswordStrength("");
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("rejects passwords shorter than MIN_PASSWORD_LENGTH", () => {
      const short = "short-9";
      expect(short.length).toBeLessThan(MIN_PASSWORD_LENGTH);
      const result = validatePasswordStrength(short);
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`);
    });

    it("rejects non-string inputs", () => {
      expect(validatePasswordStrength(null as unknown as string).isValid).toBe(false);
      expect(validatePasswordStrength(undefined as unknown as string).isValid).toBe(false);
      expect(validatePasswordStrength(1234567890 as unknown as string).isValid).toBe(false);
    });
  });

  describe("hashPassword and verifyPassword", () => {
    it("hashes and verifies a correct password successfully", async () => {
      const password = "correct-operator-password-99";
      const hash = await hashPassword(password);

      expect(typeof hash).toBe("string");
      expect(hash.startsWith("$scrypt$v=1$")).toBe(true);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it("rejects an incorrect password", async () => {
      const correct = "valid-operator-secret-1";
      const wrong = "wrong-operator-secret-2";
      const hash = await hashPassword(correct);

      const isValid = await verifyPassword(wrong, hash);
      expect(isValid).toBe(false);
    });

    it("generates distinct salts and hashes for the same password hashed twice", async () => {
      const password = "same-operator-password-100";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);

      // Both hashes should still verify the same password
      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });

    it("generates distinct hashes for different passwords", async () => {
      const hash1 = await hashPassword("first-strong-password-1");
      const hash2 = await hashPassword("second-strong-password-2");

      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword("first-strong-password-1", hash1)).toBe(true);
      expect(await verifyPassword("first-strong-password-1", hash2)).toBe(false);
    });

    it("rejects hashing empty or too short passwords with an Error", async () => {
      await expect(hashPassword("")).rejects.toThrow(/empty/);
      await expect(hashPassword("short-88")).rejects.toThrow(/at least 10 characters/);
    });

    it("includes algorithm and version information in the hash format", async () => {
      const hash = await hashPassword("format-test-password-123");
      const parts = hash.split("$");

      // Format: $scrypt$v=1$N=16384,r=8,p=1$<saltHex>$<hashHex>
      expect(parts.length).toBe(6);
      expect(parts[1]).toBe("scrypt");
      expect(parts[2]).toBe("v=1");
      expect(parts[3]).toBe(`N=${SCRYPT_CONFIG.N},r=${SCRYPT_CONFIG.r},p=${SCRYPT_CONFIG.p}`);
      expect(parts[4]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
      expect(parts[5]).toMatch(/^[0-9a-f]{128}$/); // 64 bytes = 128 hex chars
    });

    it("safely rejects malformed stored hashes without throwing", async () => {
      const validPw = "test-operator-pass-123";

      // Non-scrypt prefix
      expect(await verifyPassword(validPw, "not-a-hash")).toBe(false);
      expect(await verifyPassword(validPw, "$bcrypt$v=1$...")).toBe(false);
      expect(await verifyPassword(validPw, "")).toBe(false);

      // Wrong part count
      expect(await verifyPassword(validPw, "$scrypt$v=1$only-three")).toBe(false);

      // Wrong version
      expect(await verifyPassword(validPw, "$scrypt$v=2$N=16384,r=8,p=1$1234$5678")).toBe(false);

      // Non-numeric or missing parameters
      expect(await verifyPassword(validPw, "$scrypt$v=1$N=abc,r=8,p=1$1234$5678")).toBe(false);
      expect(await verifyPassword(validPw, "$scrypt$v=1$missing$1234$5678")).toBe(false);

      // Out-of-bounds parameters
      expect(await verifyPassword(validPw, "$scrypt$v=1$N=512,r=8,p=1$1234$5678")).toBe(false); // N < 1024
      expect(await verifyPassword(validPw, "$scrypt$v=1$N=1000,r=8,p=1$1234$5678")).toBe(false); // N not power of 2
      expect(await verifyPassword(validPw, "$scrypt$v=1$N=16384,r=0,p=1$1234$5678")).toBe(false); // r < 1

      // Invalid hex
      expect(await verifyPassword(validPw, "$scrypt$v=1$N=16384,r=8,p=1$not-hex!$not-hex!")).toBe(false);

      // Non-string passwords
      expect(await verifyPassword("" as unknown as string, "$scrypt$v=1$N=16384,r=8,p=1$aa$bb")).toBe(false);
      expect(await verifyPassword(null as unknown as string, "$scrypt$v=1$N=16384,r=8,p=1$aa$bb")).toBe(false);
    });
  });
});

