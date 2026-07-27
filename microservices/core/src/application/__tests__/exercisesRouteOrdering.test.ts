/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-mounting guard for the `/exercises` family (spec-21 § 3, T-1.7).
//
// `GET /exercises/substitutes` and `GET /exercises/search` are LITERAL paths
// under a prefix that also has a `:id` matcher. If either is registered after
// `exercisesGetHandler`, that matcher captures "substitutes" / "search" as an
// exercise id and the request reaches the wrong handler — which returns a
// different shape, so mobile renders an empty picker rather than erroring.
//
// This is the reason `exercisesSubstitutesHandler` does NOT live in the
// late-mounting `loadoutRoutes` sub-app, and a handler test cannot catch it.
// Asserted through the same relative mounting order api.ts uses.

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

// Markers so the assertion can tell WHICH handler the router selected.
const DETAIL_MARKER = { id: "MARKER-DETAIL" };

const exerciseRepositoryMocks = {
  getById: vi.fn(async () => DETAIL_MARKER),
  listAdaptationCandidates: vi.fn(async () => ({
    candidates: [],
    truncated: false,
  })),
  listRankableExercises: vi.fn(async () => ({
    candidates: [],
    truncated: false,
  })),
  listPreviouslyLoggedExerciseIds: vi.fn(async () => []),
  search: vi.fn(async () => ({ rows: [{ id: "MARKER-SEARCH" }], total: 1 })),
};

vi.mock("../repositories/exerciseRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../repositories/exerciseRepository")
  >("../repositories/exerciseRepository");
  return {
    ...actual,
    ExerciseRepository: vi
      .fn()
      .mockImplementation(() => exerciseRepositoryMocks),
  };
});

vi.mock("../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => ({
    findUnknownEquipmentTypeIds: vi.fn(async () => []),
  })),
}));

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

function authed(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer token" },
  });
}

async function buildApp() {
  const { default: Elysia } = await import("elysia");
  const { exercisesSearchHandler } =
    await import("../exercises/search/exercisesSearchHandler");
  const { exercisesSubstitutesHandler } =
    await import("../exercises/substitutes/exercisesSubstitutesHandler");
  const { exercisesGetHandler } =
    await import("../exercises/get/exercisesGetHandler");

  // Same relative order as api.ts.
  return new Elysia()
    .use(exercisesSearchHandler)
    .use(exercisesSubstitutesHandler)
    .use(exercisesGetHandler);
}

describe("/exercises route ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exerciseRepositoryMocks.getById.mockResolvedValue(DETAIL_MARKER);
    exerciseRepositoryMocks.listRankableExercises.mockResolvedValue({
      candidates: [],
      truncated: false,
    });
  });

  it("routes /exercises/substitutes to the picker, not the :id matcher", async () => {
    const app = await buildApp();

    const res = await app.handle(
      authed(`/exercises/substitutes?forExerciseId=${SOURCE_ID}`),
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    // The detail handler would return `{ data: { id: "MARKER-DETAIL" } }`.
    expect(body.data).toHaveProperty("best");
    expect(body.data).not.toHaveProperty("id");
  });

  it("still routes /exercises/:id to the detail handler", async () => {
    const app = await buildApp();

    const res = await app.handle(authed(`/exercises/${SOURCE_ID}`));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.id).toBe("MARKER-DETAIL");
  });

  it("still routes /exercises/search to the search handler", async () => {
    const app = await buildApp();

    const res = await app.handle(authed("/exercises/search?q=bench"));
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.data[0].id).toBe("MARKER-SEARCH");
  });

  it("is mounted before exercisesGetHandler in api.ts itself", async () => {
    // The composed-app assertions above prove the ORDER works; this proves the
    // real api.ts uses it. A future edit that moves the mount below the `:id`
    // handler would pass every other test in this file.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");

    const apiPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../api.ts",
    );
    const source = readFileSync(apiPath, "utf8");

    const substitutesAt = source.indexOf(".use(exercisesSubstitutesHandler)");
    const getAt = source.indexOf(".use(exercisesGetHandler)");

    expect(substitutesAt).toBeGreaterThan(-1);
    expect(getAt).toBeGreaterThan(-1);
    expect(substitutesAt).toBeLessThan(getAt);
  });
});
