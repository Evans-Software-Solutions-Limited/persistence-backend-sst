/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { isTrainer: vi.fn(), getOverview: vi.fn() };

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

// PER-114: the practice-level adherence comes from the shared calculation
// (covered by adherence/__tests__); pinned here.
const PRACTICE = {
  calories: { daysOnTarget: 3, daysCounted: 7, daysNotLogged: 2, clients: 1 },
};
vi.mock("../../../adherence/coachAdherence", () => ({
  overviewAdherenceByArea: vi.fn(async () => PRACTICE),
}));

describe("trainersOverviewHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
    mocks.getOverview.mockResolvedValue({ trainer: { name: "T" } });
  });

  it("requires authentication", async () => {
    const { trainersOverviewHandler } =
      await import("../trainersOverviewHandler");
    const res = await trainersOverviewHandler.handle(
      new Request("http://localhost/trainers/me/overview"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersOverviewHandler } =
      await import("../trainersOverviewHandler");
    const res = await trainersOverviewHandler.handle(
      new Request("http://localhost/trainers/me/overview", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.message).toBe("Forbidden");
    expect(mocks.getOverview).not.toHaveBeenCalled();
  });

  it("returns the overview for a trainer", async () => {
    const { trainersOverviewHandler } =
      await import("../trainersOverviewHandler");
    const res = await trainersOverviewHandler.handle(
      new Request("http://localhost/trainers/me/overview", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.trainer.name).toBe("T");
    expect(body.data.adherenceByArea).toEqual(PRACTICE);
    expect(mocks.getOverview).toHaveBeenCalledWith("trainer-id");
  });
});
