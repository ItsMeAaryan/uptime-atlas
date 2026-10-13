import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../prisma";
import {
  toggleMonitorPublication,
  getStatusPageData,
  regeneratePublicId,
} from "./status-page-service";

describe("Public Status Page End-to-End Integration", () => {
  let initialMonitorsSnapshot: {
    id: string;
    name: string;
    url: string;
    currentStatus: string;
  }[] = [];

  let testMonitorId: string;
  const testMonitorName = "Status Page Integration API";
  const privateSecretUrl = "https://private-cluster.internal.corp:8443/metrics?token=supersecret123";

  beforeAll(async () => {
    // 1. Take snapshot of existing persistent monitors
    const existing = await prisma.monitor.findMany({
      where: {
        NOT: [
          { slug: { startsWith: "lifecycle-" } },
          { slug: { startsWith: "status-test-" } },
        ],
      },
      select: { id: true, name: true, url: true, currentStatus: true },
    });
    initialMonitorsSnapshot = existing;

    // 2. Create an isolated test monitor (defaults to isPublic: false)
    const temp = await prisma.monitor.create({
      data: {
        name: testMonitorName,
        slug: `status-test-${Date.now()}`,
        url: privateSecretUrl,
        method: "GET",
        isPublic: false,
        currentStatus: "UP",
      },
    });

    testMonitorId = temp.id;

    // Add 2 checks today (1 UP, 1 DOWN) to verify calendar aggregation in integration tests
    await prisma.checkResult.createMany({
      data: [
        {
          monitorId: testMonitorId,
          status: "UP",
          statusCode: 200,
          responseTimeMs: 120,
          checkedAt: new Date(),
        },
        {
          monitorId: testMonitorId,
          status: "DOWN",
          statusCode: 500,
          responseTimeMs: null,
          errorMessage: "Internal server error: database crashed at 10.0.0.99",
          checkedAt: new Date(),
        },
      ],
    });
  });

  afterAll(async () => {
    // Cleanup temporary monitor and cascade records
    if (testMonitorId) {
      await prisma.monitor.delete({
        where: { id: testMonitorId },
      });
    }

    await prisma.$disconnect();
  });

  it("1. A private monitor is not accessible via getStatusPageData", async () => {
    const data = await getStatusPageData("pub_random_guess_12345");
    expect(data).toBeNull();
  });

  it("2. Toggling publication creates a non-guessable publicId and publishes the status page with 90-day calendar", async () => {
    const pubResult = await toggleMonitorPublication(testMonitorId, true);

    expect(pubResult.isPublic).toBe(true);
    expect(pubResult.publicId).toMatch(/^pub_[a-f0-9]{32}$/);

    const publicData = await getStatusPageData(pubResult.publicId!);

    expect(publicData).not.toBeNull();
    expect(publicData?.name).toBe(testMonitorName);
    expect(publicData?.currentStatus).toBe("UP");

    // publicId is omitted from payload body
    expect((publicData as any)?.publicId).toBeUndefined();

    // 90-day calendar is populated
    expect(publicData?.calendar).toBeDefined();
    expect(publicData?.calendar.rangeDays).toBe(90);
    expect(publicData?.calendar.timezone).toBe("UTC");
    expect(publicData?.calendar.days).toHaveLength(90);

    // Today has 2 checks (1 UP, 1 DOWN) -> DEGRADED, 50% uptime
    const today = publicData?.calendar.days[publicData.calendar.days.length - 1];
    expect(today?.totalChecks).toBe(2);
    expect(today?.upChecks).toBe(1);
    expect(today?.downChecks).toBe(1);
    expect(today?.status).toBe("DEGRADED");
    expect(today?.uptimePercentage).toBe(50.0);
    expect(today?.avgResponseTimeMs).toBe(120);
  });

  it("3. Public status page strictly conceals internal database ID, target URL, and token", async () => {
    const monitor = await prisma.monitor.findUniqueOrThrow({
      where: { id: testMonitorId },
    });

    const publicData = await getStatusPageData(monitor.publicId!);
    expect(publicData).not.toBeNull();

    const rawSerialized = JSON.stringify(publicData);

    // Verify private URL and credentials are NOT in public payload
    expect(rawSerialized).not.toContain(privateSecretUrl);
    expect(rawSerialized).not.toContain("private-cluster.internal.corp");
    expect(rawSerialized).not.toContain("supersecret123");

    // Verify internal worker error details (e.g., 10.0.0.99) are NOT in public payload
    expect(rawSerialized).not.toContain("10.0.0.99");
    expect(rawSerialized).not.toContain("database crashed");

    // Verify publicId token is NOT leaked in the payload body
    expect(rawSerialized).not.toContain(monitor.publicId!);

    // Verify internal monitor database UUID is NOT in public payload
    expect(rawSerialized).not.toContain(testMonitorId);
    expect((publicData as any).id).toBeUndefined();
    expect((publicData as any).url).toBeUndefined();
  });

  it("4. Regenerating public token invalidates the old URL and activates the new one", async () => {
    const before = await prisma.monitor.findUniqueOrThrow({
      where: { id: testMonitorId },
    });
    const oldToken = before.publicId!;

    const updated = await regeneratePublicId(testMonitorId);
    const newToken = updated.publicId!;

    expect(newToken).not.toBe(oldToken);
    expect(newToken).toMatch(/^pub_[a-f0-9]{32}$/);

    // Old token must immediately 404
    expect(await getStatusPageData(oldToken)).toBeNull();

    // New token works
    const newPublicData = await getStatusPageData(newToken);
    expect(newPublicData).not.toBeNull();
    expect(newPublicData?.name).toBe(testMonitorName);
    expect((newPublicData as any)?.publicId).toBeUndefined();
  });

  it("5. Disabling publication immediately revokes public access (returns null / 404)", async () => {
    const monitor = await prisma.monitor.findUniqueOrThrow({
      where: { id: testMonitorId },
    });

    // Make private
    await toggleMonitorPublication(testMonitorId, false);

    // Query with publicId
    const data = await getStatusPageData(monitor.publicId!);
    expect(data).toBeNull();
  });

  it("6. Pre-existing database monitors remain unaffected by the test", async () => {
    for (const initial of initialMonitorsSnapshot) {
      const match = await prisma.monitor.findUnique({
        where: { id: initial.id },
      });
      expect(match).toBeDefined();
      expect(match!.name).toBe(initial.name);
      expect(match!.url).toBe(initial.url);
      expect(match!.currentStatus).toBe(initial.currentStatus);
    }
  });

  it("7. Attempting to toggle publication or regenerate token on non-existent monitor throws error", async () => {
    const nonexistentId = "00000000-0000-0000-0000-000000000000";

    await expect(toggleMonitorPublication(nonexistentId, true)).rejects.toThrow(
      `Monitor with ID "${nonexistentId}" not found.`
    );

    await expect(regeneratePublicId(nonexistentId)).rejects.toThrow(
      `Monitor with ID "${nonexistentId}" not found.`
    );
  });

  it("8. Invalid or unpublished tokens return null (404)", async () => {
    // Arbitrary unknown token
    expect(await getStatusPageData("pub_unknown_invalid_token")).toBeNull();

    // Malformed empty or non-string tokens
    expect(await getStatusPageData("")).toBeNull();
    expect(await getStatusPageData("   ")).toBeNull();

    // Monitor that was unpublished in test 5 has a valid publicId format, but returns null because isPublic is false
    const monitor = await prisma.monitor.findUniqueOrThrow({
      where: { id: testMonitorId },
    });
    expect(monitor.isPublic).toBe(false);
    expect(monitor.publicId).not.toBeNull();
    expect(await getStatusPageData(monitor.publicId!)).toBeNull();
  });
});
