import crypto from "node:crypto";

/**
 * Minimum required password length for the operator account.
 * Enforces a strong baseline to mitigate brute-force and dictionary attacks.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Default scrypt parameters complying with OWASP recommendations:
 * - N (CPU/memory cost): 16384 (2^14), providing strong resistance to ASIC/GPU attacks
 *   while maintaining reasonable latency (~50-100ms) for interactive logins.
 * - r (block size): 8
 * - p (parallelization): 1
 * - keyLength: 64 bytes (512 bits) of derived key material.
 * - saltLength: 16 bytes (128 bits) of cryptographically random entropy.
 * - maxmem: 32MB safe upper memory limit for scrypt execution.
 */
export const SCRYPT_CONFIG = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
  maxmem: 32 * 1024 * 1024,
  version: "v=1",
} as const;

/**
 * Validates password strength policy.
 */
export function validatePasswordStrength(password: unknown): { isValid: boolean; reason?: string } {
  if (typeof password !== "string" || password.length === 0) {
    return { isValid: false, reason: "Password cannot be empty." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      isValid: false,
      reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }
  return { isValid: true };
}

/**
 * Hashes a plain-text password using Node.js crypto.scrypt.
 *
 * Security decisions:
 * 1. Generates a fresh, cryptographically secure 16-byte random salt per password.
 * 2. Uses asynchronous scrypt to avoid blocking Node.js event loop during heavy hashing.
 * 3. Encodes the result in a versioned, self-contained PHC-style string:
 *    $scrypt$v=1$N=16384,r=8,p=1$<salt_hex>$<derived_hash_hex>
 *    This allows seamless future parameter upgrades without breaking existing hashes.
 * 4. Strictly validates minimum password length before performing any derivation.
 */
export async function hashPassword(password: string): Promise<string> {
  const validation = validatePasswordStrength(password);
  if (!validation.isValid) {
    throw new Error(validation.reason || "Invalid password.");
  }

  const salt = crypto.randomBytes(SCRYPT_CONFIG.saltLength);

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_CONFIG.keyLength,
      {
        N: SCRYPT_CONFIG.N,
        r: SCRYPT_CONFIG.r,
        p: SCRYPT_CONFIG.p,
        maxmem: SCRYPT_CONFIG.maxmem,
      },
      (err, key) => {
        if (err) reject(err);
        else resolve(key as Buffer);
      }
    );
  });

  const saltHex = salt.toString("hex");
  const hashHex = derivedKey.toString("hex");
  const paramsStr = `N=${SCRYPT_CONFIG.N},r=${SCRYPT_CONFIG.r},p=${SCRYPT_CONFIG.p}`;

  return `$scrypt$${SCRYPT_CONFIG.version}$${paramsStr}$${saltHex}$${hashHex}`;
}

/**
 * Verifies a plain-text password against a stored scrypt password hash.
 *
 * Security decisions:
 * 1. Safely rejects malformed stored hashes or non-string inputs by returning false.
 * 2. Validates parameters (N, r, p) within strict bounds to prevent DoS via tampered parameters.
 * 3. Uses crypto.timingSafeEqual to prevent side-channel timing attacks during hash comparison.
 * 4. Never logs the password, salt, or hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (typeof password !== "string" || !password) {
    return false;
  }
  if (typeof storedHash !== "string" || !storedHash.startsWith("$scrypt$")) {
    return false;
  }

  try {
    const parts = storedHash.split("$");
    // Expected format: ["", "scrypt", "v=1", "N=16384,r=8,p=1", saltHex, hashHex]
    if (parts.length !== 6) {
      return false;
    }

    const [, algo, version, paramsStr, saltHex, expectedHashHex] = parts;
    if (algo !== "scrypt" || version !== "v=1") {
      return false;
    }

    // Parse parameters
    const paramsMap = new Map<string, number>();
    for (const token of paramsStr.split(",")) {
      const [k, v] = token.split("=");
      if (!k || !v) return false;
      const parsedNum = Number.parseInt(v, 10);
      if (Number.isNaN(parsedNum)) return false;
      paramsMap.set(k.trim(), parsedNum);
    }

    const N = paramsMap.get("N");
    const r = paramsMap.get("r");
    const p = paramsMap.get("p");

    if (!N || !r || !p) {
      return false;
    }

    // Prevent DoS through extreme parameters in tampered strings
    // N must be power of 2 and between 1024 and 1048576 (1M)
    if (N < 1024 || N > 1048576 || (N & (N - 1)) !== 0) {
      return false;
    }
    if (r < 1 || r > 32) {
      return false;
    }
    if (p < 1 || p > 32) {
      return false;
    }

    // Validate hex encoding
    if (!/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(expectedHashHex)) {
      return false;
    }

    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = Buffer.from(expectedHashHex, "hex");

    if (salt.length < 8 || expectedHash.length < 16) {
      return false;
    }

    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(
        password,
        salt,
        expectedHash.length,
        {
          N,
          r,
          p,
          maxmem: SCRYPT_CONFIG.maxmem,
        },
        (err, key) => {
          if (err) reject(err);
          else resolve(key as Buffer);
        }
      );
    });

    if (derivedKey.length !== expectedHash.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, expectedHash);
  } catch {
    return false;
  }
}

