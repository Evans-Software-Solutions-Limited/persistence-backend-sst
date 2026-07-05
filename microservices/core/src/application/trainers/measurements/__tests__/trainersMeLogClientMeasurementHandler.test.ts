/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

const logClientMeasurementOnBehalf = vi.fn();
vi.mock("../logClientMeasurement", () => ({
  logClientMeasurementOnBehalf: (...args: unknown[]) =>
    logClientMeasurementOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

describe("trainersMeLogClientMeasurementHandler (canonical)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logClientMeasurementOnBehalf.mockResolvedValue({
      ok: true,
      measurement: {
        id: "m-1",
        userId: "client-1",
        loggedByUserId: "trainer-id",
        weightKg: "80.5",
        measuredAt: new Date(),
      },
    });
  });

  function post(clientId: string, body: unknown, headers = auth) {
    return new Request(
      `http://localhost/trainers/me/clients/${clientId}/measurements`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
    );
  }

  it("requires auth", async () => {
    const { trainersMeLogClientMeasurementHandler } =
      await import("../trainersMeLogClientMeasurementHandler");
    const res = await trainersMeLogClientMeasurementHandler.handle(
      new Request(
        "http://localhost/trainers/me/clients/client-1/measurements",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weightKg: 80 }),
        },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict from the core fn to the corresponding status/body", async () => {
    logClientMeasurementOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const { trainersMeLogClientMeasurementHandler } =
      await import("../trainersMeLogClientMeasurementHandler");
    const res = await trainersMeLogClientMeasurementHandler.handle(
      post("client-1", { weightKg: 80 }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_a_trainer");
  });

  it("201s and delegates to the shared core fn, stamping logged_by", async () => {
    const { trainersMeLogClientMeasurementHandler } =
      await import("../trainersMeLogClientMeasurementHandler");
    const res = await trainersMeLogClientMeasurementHandler.handle(
      post("client-1", { weightKg: 80.5 }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.id).toBe("m-1");
    expect(logClientMeasurementOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({ weightKg: 80.5 }),
    });
  });
});
