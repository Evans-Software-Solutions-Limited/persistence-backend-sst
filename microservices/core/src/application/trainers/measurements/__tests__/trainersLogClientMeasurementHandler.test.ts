/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

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

const repo = { create: vi.fn() };
vi.mock("../../../repositories/measurementRepository", () => ({
  MeasurementRepository: vi.fn(() => repo),
}));

// Keep the streak side-effect out of the test (it already runs error-tolerant
// in prod; here we just assert it doesn't break the handler).
vi.mock("../../../streaks/evaluate", () => ({
  safeEvaluateStreaks: vi.fn(async () => {}),
}));

/** Thenable query-builder mock; awaiting resolves to the next queued result. */
function executor(queue: unknown[]) {
  let i = 0;
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of ["select", "from", "where", "limit"]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (resolve: (v: unknown[]) => unknown) =>
    resolve((queue[i++] ?? []) as unknown[]);
  return builder;
}

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

describe("trainersLogClientMeasurementHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockResolvedValue({
      id: "m-1",
      userId: "client-1",
      loggedByUserId: "trainer-id",
      weightKg: "80",
      measuredAt: new Date(),
    });
  });

  function post(clientId: string, body: unknown, headers = auth) {
    return new Request(`http://localhost/clients/${clientId}/measurements`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("requires auth", async () => {
    const { trainersLogClientMeasurementHandler } =
      await import("../trainersLogClientMeasurementHandler");
    const res = await trainersLogClientMeasurementHandler.handle(
      new Request("http://localhost/clients/client-1/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: 80 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the caller has no active relationship with the client", async () => {
    (getDb as any).mockReturnValue(executor([[]])); // guard finds no row
    const { trainersLogClientMeasurementHandler } =
      await import("../trainersLogClientMeasurementHandler");
    const res = await trainersLogClientMeasurementHandler.handle(
      post("client-1", { weightKg: 80 }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_your_client");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("201 logs the weight for the client with logged_by stamped", async () => {
    (getDb as any).mockReturnValue(executor([[{ id: "rel-1" }]])); // active rel
    const { trainersLogClientMeasurementHandler } =
      await import("../trainersLogClientMeasurementHandler");
    const res = await trainersLogClientMeasurementHandler.handle(
      post("client-1", { weightKg: 80.5 }),
    );
    expect(res.status).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        loggedByUserId: "trainer-id",
        weightKg: "80.5",
      }),
    );
  });
});
