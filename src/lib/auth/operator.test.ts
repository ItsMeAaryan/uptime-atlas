import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../prisma";
import { verifyPassword } from "./password";
import { provisionOperator } from "./operator";

describe("Operator Provisioning Service", () => {
  const TEST_USERNAME = "test_ops_admin";
  const TEST_PASSWORD = "test-operator-super-secret-123";

  interface MockOperatorRecord {
    id: string;
    username: string;
    passwordHash: string;
    createdAt: Date;
    updatedAt: Date;
  }

  let mockOperators: Map<string, MockOperatorRecord>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOperators = new Map();

    // Mock count to reflect simulated operator records
    (vi.spyOn(prisma.operator, "count") as any).mockImplementation(async () => {
      return mockOperators.size;
    });

    // Mock findFirst for existing operator checks
    (vi.spyOn(prisma.operator, "findFirst") as any).mockImplementation(async () => {
      const first = Array.from(mockOperators.values())[0];
      if (!first) return null;
      return {
        id: first.id,
        username: first.username,
        passwordHash: first.passwordHash,
        createdAt: first.createdAt,
        updatedAt: first.updatedAt,
      };
    });

    // Mock findUnique for lookup assertions
    (vi.spyOn(prisma.operator, "findUnique") as any).mockImplementation(async (args: any) => {
      if (args?.where?.username) {
        const op = mockOperators.get(args.where.username);
        return op ? { ...op } : null;
      }
      if (args?.where?.id) {
        const op = Array.from(mockOperators.values()).find((o) => o.id === args.where.id);
        return op ? { ...op } : null;
      }
      return null;
    });

    // Mock create to store into in-memory map
    (vi.spyOn(prisma.operator, "create") as any).mockImplementation(async (args: any) => {
      const record: MockOperatorRecord = {
        id: "op-test-" + Math.random().toString(36).substring(2, 9),
        username: args.data.username,
        passwordHash: args.data.passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockOperators.set(record.username, record);
      return {
        id: record.id,
        username: record.username,
        createdAt: record.createdAt,
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions an operator successfully with scrypt password hash", async () => {
    const result = await provisionOperator({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });

    expect(result.success).toBe(true);
    expect(result.operator?.username).toBe(TEST_USERNAME);

    const operator = await prisma.operator.findUnique({
      where: { username: TEST_USERNAME },
    });

    expect(operator).not.toBeNull();
    expect(operator?.passwordHash).toMatch(/^\$scrypt\$v=1\$/);

    // Verify the hashed password against plain text
    const isValid = await verifyPassword(TEST_PASSWORD, operator!.passwordHash);
    expect(isValid).toBe(true);
  });

  it("rejects passwords shorter than MIN_PASSWORD_LENGTH", async () => {
    const result = await provisionOperator({
      username: TEST_USERNAME,
      password: "short-9",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("at least 10 characters");

    const operator = await prisma.operator.findUnique({
      where: { username: TEST_USERNAME },
    });
    expect(operator).toBeNull();
  });

  it("rejects empty passwords", async () => {
    const result = await provisionOperator({
      username: TEST_USERNAME,
      password: "",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("No operator password provided");
  });

  it("rejects usernames shorter than 3 characters", async () => {
    const result = await provisionOperator({
      username: "ab",
      password: TEST_PASSWORD,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("at least 3 characters");
  });

  it("refuses to overwrite an existing operator on repeated execution", async () => {
    // 1. Initial provision
    const firstResult = await provisionOperator({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    expect(firstResult.success).toBe(true);

    const firstOperator = await prisma.operator.findUnique({
      where: { username: TEST_USERNAME },
    });
    expect(firstOperator).not.toBeNull();

    // 2. Second provision attempt
    const secondResult = await provisionOperator({
      username: TEST_USERNAME,
      password: "different-password-456789",
    });

    expect(secondResult.success).toBe(false);
    expect(secondResult.message).toContain("Automatic overwrite is strictly refused");

    // 3. Confirm original operator password hash remains intact
    const operatorAfter = await prisma.operator.findUnique({
      where: { username: TEST_USERNAME },
    });
    expect(operatorAfter?.passwordHash).toBe(firstOperator?.passwordHash);
    expect(await verifyPassword(TEST_PASSWORD, operatorAfter!.passwordHash)).toBe(true);
    expect(await verifyPassword("different-password-456789", operatorAfter!.passwordHash)).toBe(false);
  });

  it("safely handles database errors during operator creation", async () => {
    (vi.spyOn(prisma.operator, "create") as any).mockRejectedValueOnce(
      new Error("Database connection pool exhausted")
    );

    await expect(
      provisionOperator({
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
      })
    ).rejects.toThrow("Database connection pool exhausted");
  });
});
