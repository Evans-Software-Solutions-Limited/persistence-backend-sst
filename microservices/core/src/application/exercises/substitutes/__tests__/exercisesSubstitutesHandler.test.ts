/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DUMBBELL = "22222222-2222-4222-8222-222222222222";
const CHEST = "33333333-3333-4333-8333-333333333333";

function ex(overrides: any = {}) {
  return {
    id: "ex-1",
    name: "Exercise",
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [],
    thumbnailUrl: null,
    ...overrides,
  };
}

const exerciseRepo = vi.hoisted(() => ({
  getById: vi.fn(),
  listAdaptationCandidates: vi.fn(),
  listRankableExercises: vi.fn(),
  listPreviouslyLoggedExerciseIds: vi.fn(async () => [] as string[]),
}));
const savedGymRepo = vi.hoisted(() => ({
  findUnknownEquipmentTypeIds: vi.fn(async () => [] as string[]),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header: string | undefined) =>
    header?.startsWith("Bearer ")
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

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepo),
}));
vi.mock("../../../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepo),
}));

async function call(query: string, authed = true) {
  const { exercisesSubstitutesHandler } =
    await import("../exercisesSubstitutesHandler");
  return exercisesSubstitutesHandler.handle(
    new Request(`http://localhost/exercises/substitutes?${query}`, {
      headers: authed ? { authorization: "Bearer token" } : {},
    }),
  );
}

describe("GET /exercises/substitutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exerciseRepo.getById.mockResolvedValue(
      ex({ id: SOURCE_ID, name: "Barbell Bench Press" }),
    );
    exerciseRepo.listAdaptationCandidates.mockResolvedValue({
      candidates: [ex({ id: "compatible", name: "Dumbbell Press" })],
      truncated: false,
    });
    exerciseRepo.listRankableExercises.mockResolvedValue({
      candidates: [
        ex({ id: "compatible", name: "Dumbbell Press" }),
        ex({ id: "incompatible", name: "Cable Fly" }),
      ],
      truncated: false,
    });
    exerciseRepo.listPreviouslyLoggedExerciseIds.mockResolvedValue([]);
    savedGymRepo.findUnknownEquipmentTypeIds.mockResolvedValue([]);
  });

  it("401s an unauthenticated caller", async () => {
    const res = await call(`forExerciseId=${SOURCE_ID}`, false);
    expect(res.status).toBe(401);
    expect(exerciseRepo.getById).not.toHaveBeenCalled();
  });

  it("404s a source the caller cannot see — no existence leak", async () => {
    exerciseRepo.getById.mockResolvedValue(null);

    const res = await call(`forExerciseId=${SOURCE_ID}`);

    expect(res.status).toBe(404);
  });

  it("scopes the source read to the caller (AC-3.6)", async () => {
    await call(`forExerciseId=${SOURCE_ID}`);
    expect(exerciseRepo.getById).toHaveBeenCalledWith(SOURCE_ID, "user-a");
  });

  it("splits compatible picks into best and the rest into others", async () => {
    const res = await call(`forExerciseId=${SOURCE_ID}&equipment=${DUMBBELL}`);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.best.map((e: any) => e.id)).toEqual(["compatible"]);
    // `others` must EXCLUDE what is already in `best`, or the picker renders the
    // same exercise twice — once selectable, once dimmed.
    expect(body.data.others.map((e: any) => e.id)).toEqual(["incompatible"]);
  });

  it("returns why each entry matched, so the client need not re-derive it", async () => {
    const res = await call(`forExerciseId=${SOURCE_ID}&equipment=${DUMBBELL}`);
    const body = (await res.json()) as any;

    expect(body.data.best[0].matchedOn).toContain("primary_muscles");
    expect(body.data.best[0]).toMatchObject({
      id: "compatible",
      name: "Dumbbell Press",
      equipmentRequired: [],
    });
  });

  it("returns an EMPTY best list when no kit is supplied, not the whole library", async () => {
    // The standalone in-session swap (AC-4.4) may have no kit context. `best`
    // would otherwise duplicate `others`, because an empty containment array
    // drops the SQL predicate entirely.
    const res = await call(`forExerciseId=${SOURCE_ID}`);
    const body = (await res.json()) as any;

    expect(body.data.best).toEqual([]);
    // Both score identically here, so the `name ASC` tiebreak decides:
    // "Cable Fly" before "Dumbbell Press".
    expect(body.data.others.map((e: any) => e.id)).toEqual([
      "incompatible",
      "compatible",
    ]);
    expect(exerciseRepo.listAdaptationCandidates).not.toHaveBeenCalled();
  });

  it("400s unknown equipment ids rather than silently narrowing best", async () => {
    savedGymRepo.findUnknownEquipmentTypeIds.mockResolvedValue(["ghost"]);

    const res = await call(`forExerciseId=${SOURCE_ID}&equipment=${DUMBBELL}`);
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.code).toBe("UNKNOWN_EQUIPMENT_TYPE");
    expect(body.unknownEquipmentTypeIds).toEqual(["ghost"]);
  });

  it("returns empty lists — with no queries — when the source has no primary movers", async () => {
    exerciseRepo.getById.mockResolvedValue(
      ex({ id: SOURCE_ID, primaryMuscles: [] }),
    );

    const res = await call(`forExerciseId=${SOURCE_ID}`);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ best: [], others: [] });
    expect(exerciseRepo.listRankableExercises).not.toHaveBeenCalled();
  });

  it("tolerates NULL array columns on the source row", async () => {
    // Legacy rows predate the `.default([])`, so the handler normalises rather
    // than assuming the columns are populated.
    exerciseRepo.getById.mockResolvedValue({
      id: SOURCE_ID,
      name: "Legacy",
      category: null,
      difficultyLevel: null,
      movementType: null,
      primaryMuscles: null,
      secondaryMuscles: null,
      equipmentRequired: null,
      thumbnailUrl: null,
    });

    const res = await call(`forExerciseId=${SOURCE_ID}`);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.best).toEqual([]);
  });

  it("clamps the limit and applies it per list", async () => {
    exerciseRepo.listRankableExercises.mockResolvedValue({
      candidates: [
        ex({ id: "a", name: "A" }),
        ex({ id: "b", name: "B" }),
        ex({ id: "c", name: "C" }),
      ],
      truncated: false,
    });

    const res = await call(`forExerciseId=${SOURCE_ID}&limit=2`);

    expect(((await res.json()) as any).data.others).toHaveLength(2);
  });

  it("reports truncation from either pool", async () => {
    exerciseRepo.listRankableExercises.mockResolvedValue({
      candidates: [],
      truncated: true,
    });

    const res = await call(`forExerciseId=${SOURCE_ID}`);

    expect(((await res.json()) as any).data.meta.truncated).toBe(true);
  });

  it("never offers the source exercise as its own substitute", async () => {
    await call(`forExerciseId=${SOURCE_ID}&equipment=${DUMBBELL}`);

    expect(exerciseRepo.listAdaptationCandidates).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ excludeExerciseIds: [SOURCE_ID] }),
    );
    expect(exerciseRepo.listRankableExercises).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ excludeExerciseIds: [SOURCE_ID] }),
    );
  });
});
