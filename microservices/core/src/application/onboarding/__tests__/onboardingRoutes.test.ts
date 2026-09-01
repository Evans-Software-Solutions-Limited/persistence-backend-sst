/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = { get: vi.fn(), put: vi.fn() };
vi.mock("../../repositories/onboardingStateRepository", async () => {
  const actual = await vi.importActual<any>(
    "../../repositories/onboardingStateRepository",
  );
  return { ...actual, OnboardingStateRepository: vi.fn(() => repository) };
});
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header?: string) =>
    header ? { sub: "user-a" } : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user),
}));

describe("onboardingRoutes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    const { onboardingRoutes } = await import("../onboardingRoutes");
    expect(
      (
        await onboardingRoutes.handle(
          new Request("http://localhost/users/me/onboarding"),
        )
      ).status,
    ).toBe(401);
  });

  it("gets only the JWT user's state", async () => {
    repository.get.mockResolvedValue({ status: "in_progress" });
    const { onboardingRoutes } = await import("../onboardingRoutes");
    const res = await onboardingRoutes.handle(
      new Request("http://localhost/users/me/onboarding", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    expect(repository.get).toHaveBeenCalledWith("user-a");
  });

  it("returns data:null before the first state is persisted", async () => {
    repository.get.mockResolvedValue(null);
    const { onboardingRoutes } = await import("../onboardingRoutes");
    const res = await onboardingRoutes.handle(
      new Request("http://localhost/users/me/onboarding", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(await res.json()).toEqual({ data: null });
  });

  it("puts a validated full state under the JWT user id", async () => {
    repository.put.mockResolvedValue({ status: "dismissed" });
    const { onboardingRoutes } = await import("../onboardingRoutes");
    const body = {
      version: 1,
      currentPage: "welcome",
      completedPages: [],
      skippedPages: [],
      status: "dismissed",
      path: null,
      coachClientBand: null,
      intentKeys: [],
    };
    const res = await onboardingRoutes.handle(
      new Request("http://localhost/users/me/onboarding", {
        method: "PUT",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    expect(repository.put).toHaveBeenCalledWith("user-a", body);
  });
});
