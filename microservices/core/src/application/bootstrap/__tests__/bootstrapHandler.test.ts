/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";

const loadBootstrapMock = vi.hoisted(() =>
  vi.fn(async (_deps: any, req: any) => ({
    generatedAt: "2026-10-12T10:00:00.000Z",
    sections: Object.fromEntries(
      req.sections.map((s: string) => [s, { ok: true, value: s }]),
    ),
  })),
);
vi.mock("../loadBootstrap", () => ({ loadBootstrap: loadBootstrapMock }));
vi.mock("../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi
    .fn()
    .mockImplementation(() => ({ findForUser: vi.fn() })),
}));
vi.mock("../../repositories/subscriptionTiersRepository", () => ({
  SubscriptionTiersRepository: vi
    .fn()
    .mockImplementation(() => ({ listActive: vi.fn() })),
}));
vi.mock("../../founding/foundingGrantService", () => ({
  FoundingGrantService: vi
    .fn()
    .mockImplementation(() => ({ applyPendingForUser: vi.fn() })),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? { sub: "u1", email: "e@x.y", email_verified: true, iat: 0, exp: 9e9 }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user),
}));

import { bootstrapHandler } from "../bootstrapHandler";
import { BOOTSTRAP_SECTIONS } from "../sections";

// `null` means no Authorization header (an explicit `undefined` would select
// the default parameter).
const call = (query = "", auth: string | null = "Bearer t") =>
  bootstrapHandler.handle(
    new Request(`http://localhost/users/me/bootstrap${query}`, {
      headers: auth ? { authorization: auth } : {},
    }),
  );

describe("GET /users/me/bootstrap", () => {
  beforeEach(() => {
    loadBootstrapMock.mockClear();
  });

  it("requires auth", async () => {
    const res = await call("", null);
    expect(res.status).toBe(401);
    expect(loadBootstrapMock).not.toHaveBeenCalled();
  });

  it("loads every section by default with the user's id and email", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data.sections)).toEqual([...BOOTSTRAP_SECTIONS]);
    const [deps, req] = loadBootstrapMock.mock.calls[0];
    expect(req).toEqual({
      userId: "u1",
      email: "e@x.y",
      sections: BOOTSTRAP_SECTIONS,
      ownerLibraryOnly: false,
    });
    for (const key of [
      "VolumeRepository",
      "HomeReadRepository",
      "HabitConfigRepository",
      "HabitRepository",
      "StreakRepository",
      "NutritionEntryRepository",
      "NutritionTargetRepository",
      "SleepRepository",
      "ProfileRepository",
      "WorkoutRepository",
      "NotificationRepository",
      "OnboardingStateRepository",
      "ExerciseRepository",
      "subscriptions",
      "tiers",
      "founding",
    ])
      expect(deps[key], key).toBeDefined();
    expect(typeof deps.assertEntitlement).toBe("function");
    expect(typeof deps.reconcileWorkoutStreak).toBe("function");
  });

  it("honours include and ownerLibraryOnly", async () => {
    const res = await call("?include=home,tiers&ownerLibraryOnly=true");
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()).data.sections)).toEqual([
      "home",
      "tiers",
    ]);
    expect(loadBootstrapMock.mock.calls[0][1]).toMatchObject({
      sections: ["home", "tiers"],
      ownerLibraryOnly: true,
    });
  });

  it("rejects unknown sections with 400", async () => {
    const res = await call("?include=home,nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unknown bootstrap section: nope",
    });
    expect(loadBootstrapMock).not.toHaveBeenCalled();
  });
});
