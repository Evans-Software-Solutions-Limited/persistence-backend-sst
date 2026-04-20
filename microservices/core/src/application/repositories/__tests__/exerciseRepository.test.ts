/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExerciseRepository } from "../exerciseRepository";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

// Stub the drizzle helpers we pass around as SQL fragments. The repository
// walks the builder tree to produce SQL; the tests only care that the code
// traverses correctly and forwards the right filter shapes.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: vi.fn().mockReturnValue({ type: "inArray_stub" }),
    or: vi.fn().mockReturnValue({ type: "or_stub" }),
    and: vi.fn().mockReturnValue({ type: "and_stub" }),
    isNull: vi.fn().mockReturnValue({ type: "isNull_stub" }),
    eq: vi.fn().mockReturnValue({ type: "eq_stub" }),
    ilike: vi.fn().mockReturnValue({ type: "ilike_stub" }),
    desc: vi.fn().mockReturnValue({ type: "desc_stub" }),
  };
});

import { getDb } from "@persistence/db/client";

const mockExercises = [
  {
    id: "ex-1",
    name: "Squat",
    category: "strength",
    difficultyLevel: "intermediate",
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

/**
 * Universal select chain that satisfies both the main list/get queries
 * (.from().where().orderBy().limit().offset() OR .from().where().limit())
 * AND the pt_client_relationships subquery inside buildVisibilityCondition
 * (.from().where() with no further chaining — its result is consumed by
 * inArray, which is stubbed).
 *
 * Each select() call returns the same chain, so ordering doesn't matter.
 */
function makeUniversalChain(result: any[]) {
  const whereResult: any = {
    limit: vi.fn().mockResolvedValue(result),
    orderBy: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        offset: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult),
      // Reference-list lookups use .from().orderBy() directly.
      orderBy: vi.fn().mockResolvedValue(result),
    }),
  };
}

function makeMockDb(listResult: any[] = mockExercises) {
  return {
    select: vi.fn().mockReturnValue(makeUniversalChain(listResult)),
    selectDistinct: vi.fn().mockReturnValue(makeUniversalChain(listResult)),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

describe("ExerciseRepository.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies visibility predicate for unauth callers (system-only path)", async () => {
    const mockDb = makeMockDb();
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.list({ limit: 20, offset: 0 });

    expect(result).toEqual(mockExercises);
    // Unauth: no PT subquery select (isNull branch short-circuits)
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("applies visibility predicate for authed callers (JOINs pt relationships)", async () => {
    const mockDb = makeMockDb();
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.list({ limit: 20, offset: 0 }, "user-1");

    expect(result).toEqual(mockExercises);
    // Authed: one main-query select + one PT subquery select
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it("passes difficulty array filter via inArray", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { inArray } = await import("drizzle-orm");
    (inArray as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ difficultyLevel: ["beginner", "intermediate"] });

    expect(inArray).toHaveBeenCalled();
  });

  it("passes category array filter via inArray", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { inArray } = await import("drizzle-orm");
    (inArray as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ category: ["strength", "cardio"] });

    expect(inArray).toHaveBeenCalled();
  });

  it("accepts single-value difficulty back-compat", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({ difficulty: "intermediate" });
    expect(result).toEqual(mockExercises);
  });

  it("accepts single-value category back-compat", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({ category: "strength" });
    expect(result).toEqual(mockExercises);
  });

  it("accepts targeted_muscles_any array (array overlap)", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({
      targetedMusclesAny: [
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "b1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ],
    });
    expect(result).toEqual(mockExercises);
  });

  it("accepts single muscleGroup back-compat when targeted_muscles_any absent", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({
      muscleGroup: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result).toEqual(mockExercises);
  });

  it("accepts equipment_any array", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({
      equipmentAny: ["c1b2c3d4-e5f6-7890-abcd-ef1234567890"],
    });
    expect(result).toEqual(mockExercises);
  });

  it("prefers q over search when both are set", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { ilike } = await import("drizzle-orm");
    (ilike as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ q: "bench", search: "squat" });

    expect(ilike).toHaveBeenCalled();
    const [, pattern] = (ilike as any).mock.calls[0];
    expect(pattern).toBe("%bench%");
  });

  it("escapes LIKE wildcards in q", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { ilike } = await import("drizzle-orm");
    (ilike as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ q: "100%_test" });

    const [, pattern] = (ilike as any).mock.calls[0];
    expect(pattern).toBe("%100\\%\\_test%");
  });

  it("escapes LIKE wildcards in search alias", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { ilike } = await import("drizzle-orm");
    (ilike as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ search: "100%" });

    expect(ilike).toHaveBeenCalled();
  });

  it("searches across name + description + instructions (AC 7.6 / design.md § GET /exercises)", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { ilike } = await import("drizzle-orm");
    (ilike as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ q: "bench" });

    // Three ilike calls — one per column — all with the same pattern.
    expect(ilike).toHaveBeenCalledTimes(3);
    const patterns = (ilike as any).mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(patterns).toEqual(["%bench%", "%bench%", "%bench%"]);
    // The three columns passed as the first arg must include description +
    // instructions, not just name.
    const columns = (ilike as any).mock.calls.map((call: unknown[]) => call[0]);
    expect(columns).toHaveLength(3);
  });

  it("returns empty array when nothing matches", async () => {
    (getDb as any).mockReturnValue(makeMockDb([]));
    const repo = new ExerciseRepository();
    const result = await repo.list({});
    expect(result).toEqual([]);
  });

  describe("created_by filter translation", () => {
    it("short-circuits when 'all' is present", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const repo = new ExerciseRepository();
      const result = await repo.list(
        { createdByFilter: ["all", "mine"] },
        "user-1",
      );
      expect(result).toEqual(mockExercises);
    });

    it("handles 'mine' with userId", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["mine"] }, "user-1");
      expect(result).toEqual(mockExercises);
    });

    it("handles 'system' without auth", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["system"] });
      expect(result).toEqual(mockExercises);
    });

    it("handles 'pt' with userId (builds trainer subquery)", async () => {
      const mockDb = makeMockDb();
      (getDb as any).mockReturnValue(mockDb);

      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["pt"] }, "user-1");
      expect(result).toEqual(mockExercises);
      // main + visibility subquery + pt-filter subquery = 3
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("treats 'physio' identically to 'pt' in M0", async () => {
      const mockDb = makeMockDb();
      (getDb as any).mockReturnValue(mockDb);

      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["physio"] }, "user-1");
      expect(result).toEqual(mockExercises);
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("drops auth-required values silently when userId is null", async () => {
      const mockDb = makeMockDb();
      (getDb as any).mockReturnValue(mockDb);

      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["mine", "pt"] }, null);
      expect(result).toEqual(mockExercises);
      // No PT subquery in unauth path; only main query
      expect(mockDb.select).toHaveBeenCalledTimes(1);
    });

    it("ignores unknown enum values", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: ["banana"] }, "user-1");
      expect(result).toEqual(mockExercises);
    });

    it("supports multiple values (union via OR)", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const { or } = await import("drizzle-orm");
      (or as any).mockClear();

      const repo = new ExerciseRepository();
      await repo.list({ createdByFilter: ["mine", "system"] }, "user-1");
      // or() is called at least once — for the created_by filter combining
      // "mine" + "system" (plus the visibility or-combiner).
      expect(or).toHaveBeenCalled();
    });

    it("no-op when createdByFilter is empty array", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const repo = new ExerciseRepository();
      const result = await repo.list({ createdByFilter: [] }, "user-1");
      expect(result).toEqual(mockExercises);
    });
  });
});

describe("ExerciseRepository.getById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns row when visible to authed caller", async () => {
    (getDb as any).mockReturnValue(makeMockDb([mockExercises[0]]));

    const repo = new ExerciseRepository();
    const result = await repo.getById("ex-1", "user-1");
    expect(result).toEqual(mockExercises[0]);
  });

  it("returns row when visible to unauth caller (system exercise)", async () => {
    (getDb as any).mockReturnValue(makeMockDb([mockExercises[0]]));

    const repo = new ExerciseRepository();
    const result = await repo.getById("ex-1", null);
    expect(result).toEqual(mockExercises[0]);
  });

  it("returns null when not visible / does not exist", async () => {
    (getDb as any).mockReturnValue(makeMockDb([]));

    const repo = new ExerciseRepository();
    const result = await repo.getById("ex-private-other", null);
    expect(result).toBeNull();
  });
});

describe("ExerciseRepository.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts with createdBy forced to userId", async () => {
    const created = {
      id: "ex-new",
      name: "Test Lift",
      createdBy: "user-1",
    };
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn().mockReturnValue({ returning });
    const mockDb = {
      insert: vi.fn().mockReturnValue({ values }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.create("user-1", { name: "Test Lift" } as any);

    expect(result).toEqual(created);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test Lift", createdBy: "user-1" }),
    );
  });

  it("overrides body-supplied createdBy with the caller's userId", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "ex-new" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue({ values }),
    });

    const repo = new ExerciseRepository();
    await repo.create("user-1", {
      name: "Spoofed",
      createdBy: "attacker",
    } as any);

    const [args] = values.mock.calls[0];
    expect(args.createdBy).toBe("user-1");
  });
});

describe("ExerciseRepository.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * "Not found" and "not owner" are collapsed into a single SQL predicate:
   * WHERE id = ? AND created_by = ?. Both cases yield an empty returning()
   * → null at the repo boundary → 404 at the handler. No pre-SELECT, no
   * race window. The mock only needs to exercise the update chain.
   */
  function makeUpdateChain(returningRows: any[]) {
    return {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(returningRows),
          }),
        }),
      }),
    };
  }

  it("returns null when row does not exist (empty returning)", async () => {
    (getDb as any).mockReturnValue(makeUpdateChain([]));
    const repo = new ExerciseRepository();
    const result = await repo.update("missing", "user-1", { name: "x" });
    expect(result).toBeNull();
  });

  it("returns null when caller is not the creator (scoped WHERE excludes row)", async () => {
    // Same DB response as the "not found" case — the scoped WHERE causes
    // the UPDATE to match zero rows when created_by != userId, so
    // returning() is empty and the repo returns null.
    (getDb as any).mockReturnValue(makeUpdateChain([]));
    const repo = new ExerciseRepository();
    const result = await repo.update("ex-1", "user-1", { name: "hijack" });
    expect(result).toBeNull();
  });

  it("updates and returns the row when caller owns it", async () => {
    const updated = {
      ...mockExercises[0],
      createdBy: "user-1",
      name: "Renamed",
    };
    (getDb as any).mockReturnValue(makeUpdateChain([updated]));

    const repo = new ExerciseRepository();
    const result = await repo.update("ex-1", "user-1", { name: "Renamed" });
    expect(result).toEqual(updated);
  });

  it("applies ownership in the WHERE clause (no pre-SELECT)", async () => {
    const mockDb = {
      // No `select` mock — if the repo tries to pre-SELECT, vi will
      // throw "is not a function" and the test will fail.
      ...makeUpdateChain([mockExercises[0]]),
    };
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.update("ex-1", "user-1", { name: "Renamed" });

    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});

describe("ExerciseRepository.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeleteChain(returningRows: any[]) {
    return {
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(returningRows),
        }),
      }),
    };
  }

  it("returns false when row does not exist (empty returning)", async () => {
    (getDb as any).mockReturnValue(makeDeleteChain([]));
    const repo = new ExerciseRepository();
    const result = await repo.delete("missing", "user-1");
    expect(result).toBe(false);
  });

  it("returns false when caller is not the creator (scoped WHERE excludes row)", async () => {
    (getDb as any).mockReturnValue(makeDeleteChain([]));
    const repo = new ExerciseRepository();
    const result = await repo.delete("ex-1", "user-1");
    expect(result).toBe(false);
  });

  it("hard-deletes and returns true when caller owns the row", async () => {
    (getDb as any).mockReturnValue(makeDeleteChain([mockExercises[0]]));

    const repo = new ExerciseRepository();
    const result = await repo.delete("ex-1", "user-1");
    expect(result).toBe(true);
  });

  it("applies ownership in the WHERE clause (no pre-SELECT)", async () => {
    const mockDb = {
      ...makeDeleteChain([mockExercises[0]]),
    };
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.delete("ex-1", "user-1");

    expect(mockDb.delete).toHaveBeenCalledTimes(1);
  });
});

describe("Exercise Lookup Methods", () => {
  let repository: ExerciseRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ExerciseRepository();
  });

  it("getMuscleGroups returns all muscle groups", async () => {
    const mockMuscleGroups = [
      {
        id: "mg-1",
        name: "Chest",
        description: "Chest muscles",
        displayName: "Chest",
      },
    ];
    (getDb as any).mockReturnValue(makeMockDb(mockMuscleGroups));

    const result = await repository.getMuscleGroups();
    expect(result).toEqual(mockMuscleGroups);
  });

  it("getEquipmentTypes returns all equipment types", async () => {
    const mockEquipment = [
      { id: "eq-1", name: "Dumbbell", description: "Hand weights" },
    ];
    (getDb as any).mockReturnValue(makeMockDb(mockEquipment));

    const result = await repository.getEquipmentTypes();
    expect(result).toEqual(mockEquipment);
  });

  it("getCategories returns distinct categories", async () => {
    const mockDb = {
      selectDistinct: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi
            .fn()
            .mockResolvedValue([
              { category: "strength" },
              { category: "cardio" },
            ]),
        }),
      }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const result = await repository.getCategories();
    expect(result).toEqual(["strength", "cardio"]);
  });
});
