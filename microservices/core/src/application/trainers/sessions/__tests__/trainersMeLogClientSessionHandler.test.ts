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

const logClientSessionOnBehalf = vi.fn();
vi.mock("../logClientSession", () => ({
  logClientSessionOnBehalf: (...args: unknown[]) =>
    logClientSessionOnBehalf(...args),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(clientId: string, body: unknown, headers = auth) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/sessions`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

describe("trainersMeLogClientSessionHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logClientSessionOnBehalf.mockResolvedValue({
      ok: true,
      session: { id: "s-1", userId: "client-1", loggedByUserId: "trainer-id" },
    });
  });

  it("requires auth", async () => {
    const { trainersMeLogClientSessionHandler } =
      await import("../trainersMeLogClientSessionHandler");
    const res = await trainersMeLogClientSessionHandler.handle(
      post("client-1", { status: "completed" }, {
        "Content-Type": "application/json",
      } as any),
    );
    expect(res.status).toBe(401);
  });

  it("maps a denied verdict to its status/body", async () => {
    logClientSessionOnBehalf.mockResolvedValue({
      ok: false,
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const { trainersMeLogClientSessionHandler } =
      await import("../trainersMeLogClientSessionHandler");
    const res = await trainersMeLogClientSessionHandler.handle(
      post("client-1", { status: "completed" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
  });

  it("201s and delegates to the shared core", async () => {
    const { trainersMeLogClientSessionHandler } =
      await import("../trainersMeLogClientSessionHandler");
    const res = await trainersMeLogClientSessionHandler.handle(
      post("client-1", { workoutId: "w-1", status: "completed" }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).data.id).toBe("s-1");
    expect(logClientSessionOnBehalf).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      body: expect.objectContaining({ workoutId: "w-1", status: "completed" }),
    });
  });
});
