/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { isTrainer: vi.fn(), getClients: vi.fn() };

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

vi.mock("../../../repositories/trainerRepository", () => ({
  TrainerRepository: vi.fn().mockImplementation(() => mocks),
  InviteError: class InviteError extends Error {},
}));

describe("trainersClientsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
    mocks.getClients.mockResolvedValue([
      { id: "c1", name: "Al Pha", adherence: 40, band: "atRisk" },
    ]);
  });

  it("requires authentication", async () => {
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.message).toBe("Forbidden");
    expect(mocks.getClients).not.toHaveBeenCalled();
  });

  it("returns the roster for a trainer", async () => {
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("c1");
    expect(mocks.getClients).toHaveBeenCalledWith("trainer-id");
  });
});
