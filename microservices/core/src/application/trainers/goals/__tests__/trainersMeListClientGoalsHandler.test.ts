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

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

const repoList = vi.fn();
vi.mock("../../../repositories/goalRepository", () => ({
  GoalRepository: vi.fn(() => ({ list: repoList })),
}));

import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";

const auth = { authorization: "Bearer token" };

function get(
  clientId: string,
  query = "",
  headers: Record<string, string> = auth,
) {
  return new Request(
    `http://localhost/trainers/me/clients/${clientId}/goals${query}`,
    { method: "GET", headers },
  );
}

describe("trainersMeListClientGoalsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    repoList.mockResolvedValue([{ id: "x-1" }]);
  });

  it("requires auth", async () => {
    const { trainersMeListClientGoalsHandler } =
      await import("../trainersMeListClientGoalsHandler");
    const res = await trainersMeListClientGoalsHandler.handle(
      get("client-1", "", {}),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the verdict denies", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "x" },
    });
    const { trainersMeListClientGoalsHandler } =
      await import("../trainersMeListClientGoalsHandler");
    const res = await trainersMeListClientGoalsHandler.handle(get("client-1"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
    expect(repoList).not.toHaveBeenCalled();
  });

  it("200 returns the client's goals", async () => {
    const { trainersMeListClientGoalsHandler } =
      await import("../trainersMeListClientGoalsHandler");
    const res = await trainersMeListClientGoalsHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([{ id: "x-1" }]);
    expect(repoList).toHaveBeenCalledWith("client-1", 20, 0);
  });
});
