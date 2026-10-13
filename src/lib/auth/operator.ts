import { prisma } from "../prisma";
import {
  hashPassword,
  validatePasswordStrength,
  MIN_PASSWORD_LENGTH,
} from "./password";

export interface ProvisionOperatorInput {
  username?: string;
  password?: string;
}

export interface ProvisionOperatorResult {
  success: boolean;
  message: string;
  operator?: {
    id: string;
    username: string;
    createdAt: Date;
  };
}

/**
 * Provisions the initial single operator for Uptime Atlas.
 *
 * Security & Reliability rules:
 * 1. Single-operator architecture: strictly refuses to overwrite an existing operator.
 * 2. Enforces minimum password length policy (min 10 characters).
 * 3. Never returns or logs the raw password or password hash.
 * 4. Password is authenticated with scrypt key derivation.
 */
export async function provisionOperator(
  input: ProvisionOperatorInput = {}
): Promise<ProvisionOperatorResult> {
  // 1. Refuse automatic overwrite if any operator already exists
  const existingCount = await prisma.operator.count();
  if (existingCount > 0) {
    const existing = await prisma.operator.findFirst({
      select: { username: true, createdAt: true },
    });
    return {
      success: false,
      message: `An operator ('${existing?.username}') already exists in the database (created at ${existing?.createdAt?.toISOString()}). Automatic overwrite is strictly refused to protect database integrity.`,
    };
  }

  // 2. Validate username
  const username = (input.username || process.env.OPERATOR_USERNAME || "admin").trim();
  if (username.length < 3) {
    return {
      success: false,
      message: "Username must be at least 3 characters long.",
    };
  }

  // 3. Validate password
  const password =
    input.password ||
    process.env.OPERATOR_PASSWORD ||
    process.env.OPERATOR_INITIAL_PASSWORD ||
    "";

  if (!password) {
    return {
      success: false,
      message: `No operator password provided. Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }

  const validation = validatePasswordStrength(password);
  if (!validation.isValid) {
    return {
      success: false,
      message: validation.reason || `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }

  // 4. Derive scrypt password hash
  const passwordHash = await hashPassword(password);

  // 5. Store operator record in PostgreSQL
  const created = await prisma.operator.create({
    data: {
      username,
      passwordHash,
    },
    select: {
      id: true,
      username: true,
      createdAt: true,
    },
  });

  return {
    success: true,
    message: `Operator '${created.username}' provisioned successfully.`,
    operator: created,
  };
}

