/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { list: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/measurementRepository", () => ({
  MeasurementRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("MeasurementsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: "m-1",
        userId: "test-user-id",
        weightKg: "75",
        bodyFatPercentage: null,
        chestCm: null,
        waistCm: null,
        hipsCm: null,
        leftArmCm: null,
        rightArmCm: null,
        leftThighCm: null,
        rightThighCm: null,
        notes: null,
        measuredAt: new Date(),
      },
    ]);
  });

  it("should require authentication", async () => {
    const { measurementsListHandler } =
      await import("../measurementsListHandler");
    const response = await measurementsListHandler.handle(
      new Request("http://localhost/measurements", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 with measurements list", async () => {
    const { measurementsListHandler } =
      await import("../measurementsListHandler");
    const response = await measurementsListHandler.handle(
      new Request("http://localhost/measurements", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("should support pagination", async () => {
    const { measurementsListHandler } =
      await import("../measurementsListHandler");
    await measurementsListHandler.handle(
      new Request("http://localhost/measurements?limit=10&offset=5", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", 10, 5);
  });
});
