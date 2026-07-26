/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Loadout (spec-21 § 3) route-mounting guard.
//
// Two things a unit test on an individual handler cannot catch:
//
//   1. A handler that was written but never added to `loadoutRoutes` — the
//      route would 404 in production while every handler test stayed green.
//   2. `/workouts/:id/variations` shadowing (or being shadowed by) the
//      pre-existing `/workouts/:id` matcher. Elysia's radix router prefers the
//      deeper static segment, but a regression here would silently route a
//      variations read into the workout-detail handler — which returns a
//      DIFFERENT shape, so mobile would render an empty setups list rather than
//      erroring.
//
// Both are asserted end-to-end through the composed sub-app.

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h?.startsWith("Bearer ")
      ? {
          sub: "user-a",
          email: "a@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user || { sub: "user-a" }),
}));

// Markers so we can tell which handler the router selected.
const VARIATIONS_MARKER = [{ id: "MARKER-VARIATIONS" }];
const DETAIL_MARKER = { id: "MARKER-DETAIL", exercises: [] };

const workoutRepositoryMocks = {
  canReadWorkout: vi.fn(async () => true),
  listVariations: vi.fn(async () => VARIATIONS_MARKER),
  createVariation: vi.fn(async () => DETAIL_MARKER),
  getById: vi.fn(async () => DETAIL_MARKER),
  getHistory: vi.fn(async () => null),
  list: vi.fn(),
  createWithExercises: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getQuota: vi.fn(),
};

vi.mock("../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

const savedGymRepositoryMocks = {
  list: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  create: vi.fn(async () => ({ status: "ok", gym: { id: "gym-1" } })),
  update: vi.fn(async () => ({ status: "ok", gym: { id: "gym-1" } })),
  delete: vi.fn(async () => true),
  findUnknownEquipmentTypeIds: vi.fn(async () => []),
};

vi.mock("../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepositoryMocks),
}));

vi.mock("../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => ({
    findUnreadableExerciseIds: vi.fn(async () => []),
  })),
}));

vi.mock("../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../entitlement/assertEntitlement")
  >("../entitlement/assertEntitlement");
  return {
    ...actual,
    assertEntitlement: vi.fn(async () => ({ allowed: true })),
  };
});

const WO_ID = "11111111-1111-4111-8111-111111111111";

function authed(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer token",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("loadoutRoutes mounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.canReadWorkout.mockResolvedValue(true);
    workoutRepositoryMocks.listVariations.mockResolvedValue(VARIATIONS_MARKER);
  });

  // Every Phase-0 route must actually be reachable through the sub-app. A
  // handler left out of the `.use()` chain 404s here.
  it.each([
    ["GET", "/saved-gyms"],
    ["POST", "/saved-gyms"],
    ["PATCH", `/saved-gyms/${WO_ID}`],
    ["DELETE", `/saved-gyms/${WO_ID}`],
    ["GET", `/workouts/${WO_ID}/variations`],
    ["POST", `/workouts/${WO_ID}/variations`],
  ])("registers %s %s", async (method, path) => {
    const { loadoutRoutes } = await import("../loadoutRoutes");
    const body =
      method === "POST" && path === "/saved-gyms"
        ? { name: "Gym" }
        : method === "POST"
          ? { name: "Variation", exercises: [] }
          : method === "PATCH"
            ? { name: "Renamed" }
            : undefined;

    const res = await loadoutRoutes.handle(authed(path, method, body));
    expect(res.status).not.toBe(404);
  });

  it("does not shadow, and is not shadowed by, GET /workouts/:id", async () => {
    const { default: Elysia } = await import("elysia");
    const { loadoutRoutes } = await import("../loadoutRoutes");
    const { workoutsGetHandler } =
      await import("../workouts/get/workoutsGetHandler");

    // Mounted in the SAME relative order as api.ts: the workout-detail handler
    // is registered early, loadoutRoutes mounts late.
    const app = new Elysia().use(workoutsGetHandler).use(loadoutRoutes);

    const variations = await app.handle(
      authed(`/workouts/${WO_ID}/variations`),
    );
    expect(variations.status).toBe(200);
    expect(((await variations.json()) as any).data[0].id).toBe(
      "MARKER-VARIATIONS",
    );

    // …and the plain detail route still resolves to the detail handler.
    const detail = await app.handle(authed(`/workouts/${WO_ID}`));
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as any).data.id).toBe("MARKER-DETAIL");
  });
});
