/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@x.com",
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

const recordClientSessionOnBehalf = vi.fn();
vi.mock("../recordClientSession", () => ({
  recordClientSessionOnBehalf: (...args: unknown[]) =>
    recordClientSessionOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

const validBody = {
  startedAt: "2026-05-04T10:00:00.000Z",
  status: "completed",
  exercises: [
    {
      exerciseId: "ex-1",
      sortOrder: 1,
      sets: [{ setNumber: 1, reps: 5, weightKg: 100 }],
    },
  ],
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/sessions/record`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

describe("trainersMeRecordClientSessionHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordClientSessionOnBehalf.mockResolvedValue({
      ok: true,
      session: { id: "s-1", userId: "client-1", loggedByUserId: "trainer-id" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", validBody, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("422s when the body has zero exercises (min 1, mirrors the self validator)", async () => {
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", { ...validBody, exercises: [] }),
    );
    expect(res.status).toBe(422);
    expect(recordClientSessionOnBehalf).not.toHaveBeenCalled();
  });

  it("maps a denied verdict to its status/body", async () => {
    recordClientSessionOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", validBody),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("201s and delegates to the shared core with the parsed payload", async () => {
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", validBody),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("s-1");
    expect(recordClientSessionOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      payload: expect.objectContaining({ status: "completed" }),
    });
  });

  it("accepts the installed app's duplicated 1-10 difficulty payload", async () => {
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", {
        ...validBody,
        sessionRating: 10,
        difficultyRanking: 10,
      }),
    );

    expect(res.status).toBe(201);
    expect(recordClientSessionOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      payload: expect.objectContaining({
        sessionRating: 10,
        difficultyRanking: 10,
      }),
    });
  });

  it("422s an out-of-range difficulty before delegating", async () => {
    const { trainersMeRecordClientSessionHandler } =
      await import("../trainersMeRecordClientSessionHandler");
    const res = await trainersMeRecordClientSessionHandler.handle(
      post("client-1", { ...validBody, difficultyRanking: 11 }),
    );

    expect(res.status).toBe(422);
    expect(recordClientSessionOnBehalf).not.toHaveBeenCalled();
  });
});
