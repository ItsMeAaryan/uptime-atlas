import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "./route";
import * as statusService from "@/lib/services/status-page-service";

vi.mock("@/lib/services/status-page-service");

describe("PATCH /api/monitors/[id]/publication route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully publishes a monitor", async () => {
    vi.spyOn(statusService, "toggleMonitorPublication").mockResolvedValueOnce({
      id: "mon-1",
      name: "API 1",
      isPublic: true,
      publicId: "pub_12345678901234567890123456789012",
    });

    const request = new Request("http://localhost:3000/api/monitors/mon-1/publication", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: true }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "mon-1" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.isPublic).toBe(true);
    expect(json.data.publicId).toBe("pub_12345678901234567890123456789012");
  });

  it("successfully unpublishes a monitor", async () => {
    vi.spyOn(statusService, "toggleMonitorPublication").mockResolvedValueOnce({
      id: "mon-1",
      name: "API 1",
      isPublic: false,
      publicId: "pub_12345678901234567890123456789012",
    });

    const request = new Request("http://localhost:3000/api/monitors/mon-1/publication", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "mon-1" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.isPublic).toBe(false);
  });

  it("successfully regenerates publicId", async () => {
    vi.spyOn(statusService, "regeneratePublicId").mockResolvedValueOnce({
      id: "mon-1",
      name: "API 1",
      isPublic: true,
      publicId: "pub_newtoken12345678901234567890123",
    });

    const request = new Request("http://localhost:3000/api/monitors/mon-1/publication", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerate: true }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "mon-1" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.publicId).toBe("pub_newtoken12345678901234567890123");
  });

  it("returns 404 when monitor is not found", async () => {
    vi.spyOn(statusService, "toggleMonitorPublication").mockRejectedValueOnce(
      new Error('Monitor with ID "mon-missing" not found.')
    );

    const request = new Request("http://localhost:3000/api/monitors/mon-missing/publication", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: true }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "mon-missing" }),
    });

    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("Monitor not found");
  });

  it("returns 400 when payload is invalid", async () => {
    const request = new Request("http://localhost:3000/api/monitors/mon-1/publication", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "mon-1" }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain("Invalid request payload");
  });
});
