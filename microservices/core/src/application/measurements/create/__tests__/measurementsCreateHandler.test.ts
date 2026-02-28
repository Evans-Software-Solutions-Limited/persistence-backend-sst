/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { create: vi.fn() };

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

describe("MeasurementsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
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
    });
  });

  it("should require authentication", async () => {
    const { measurementsCreateHandler } =
      await import("../measurementsCreateHandler");
    const response = await measurementsCreateHandler.handle(
      new Request("http://localhost/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 201 on successful creation", async () => {
    const { measurementsCreateHandler } =
      await import("../measurementsCreateHandler");
    const response = await measurementsCreateHandler.handle(
      new Request("http://localhost/measurements", {
        method: "POST",
        body: JSON.stringify({ weightKg: 75 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(data.data.id).toBe("m-1");
  });

  it("should accept optional body measurements", async () => {
    const { measurementsCreateHandler } =
      await import("../measurementsCreateHandler");
    const response = await measurementsCreateHandler.handle(
      new Request("http://localhost/measurements", {
        method: "POST",
        body: JSON.stringify({ weightKg: 75, chestCm: 100, waistCm: 85 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
  });
});
