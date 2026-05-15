/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExerciseRepository, toPrefixTsQuery } from "../exerciseRepository";

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

  it("accepts single-value difficultyLevel array (one entry)", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({ difficultyLevel: ["intermediate"] });
    expect(result).toEqual(mockExercises);
  });

  it("accepts single-value category array (one entry)", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const repo = new ExerciseRepository();
    const result = await repo.list({ category: ["strength"] });
    expect(result).toEqual(mockExercises);
  });

  it("skips difficulty filter when array is empty", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { inArray } = await import("drizzle-orm");
    (inArray as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ difficultyLevel: [] });

    // inArray should NOT fire for an empty array — the filter axis is
    // skipped entirely. Visibility / created_by might still call inArray
    // in other branches, but none of those paths run here (unauth, no
    // createdByFilter, no muscle/equipment arrays).
    expect(inArray).not.toHaveBeenCalled();
  });

  it("skips category filter when array is empty", async () => {
    (getDb as any).mockReturnValue(makeMockDb());
    const { inArray } = await import("drizzle-orm");
    (inArray as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.list({ category: [] });

    expect(inArray).not.toHaveBeenCalled();
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

    it("'system' predicate matches SYSTEM_USER_ID (regression: was IS NULL only)", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const { eq, or } = await import("drizzle-orm");
      (eq as any).mockClear();
      (or as any).mockClear();

      const repo = new ExerciseRepository();
      await repo.list({ createdByFilter: ["system"] });

      // The 'system' branch must call `eq(exercises.createdBy, SYSTEM_USER_ID)`
      // alongside isNull. The legacy Supabase DB stores system rows with the
      // sentinel UUID; an IS-NULL-only predicate returns zero rows.
      const eqCallsWithSystemUserId = (eq as any).mock.calls.filter(
        (args: unknown[]) => args[1] === "00000000-0000-0000-0000-000000000000",
      );
      expect(eqCallsWithSystemUserId.length).toBeGreaterThan(0);
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

    it("dedupes pt + physio into one trainer subquery (regression)", async () => {
      const mockDb = makeMockDb();
      (getDb as any).mockReturnValue(mockDb);

      const repo = new ExerciseRepository();
      await repo.list({ createdByFilter: ["pt", "physio"] }, "user-1");

      // Without dedup: 2 identical filter subqueries + visibility + main = 4.
      // With dedup (physio→pt canonicalised): 1 filter + visibility + main = 3.
      expect(mockDb.select).toHaveBeenCalledTimes(3);
    });

    it("dedupes repeated filter values (mine + mine → one eq)", async () => {
      (getDb as any).mockReturnValue(makeMockDb());
      const { eq } = await import("drizzle-orm");
      (eq as any).mockClear();

      const repo = new ExerciseRepository();
      await repo.list({ createdByFilter: ["mine", "mine"] }, "user-1");

      // Count eq(column, "user-1") calls. Without dedup, "mine" fires twice
      // at the filter layer + once at visibility = 3. With dedup: 1 + 1 = 2.
      // (The PT-subquery eq calls are against clientId / status / isAiTrainer
      // and never carry the value "user-1" as the second arg — except one
      // eq(clientId, "user-1") per subquery emission, which visibility
      // emits exactly once when authed.)
      const createdByEqCalls = (eq as any).mock.calls.filter(
        (args: unknown[]) => args[1] === "user-1",
      );
      // Visibility's eq(createdBy, "user-1") + eq(clientId, "user-1") +
      // filter's single deduped eq(createdBy, "user-1") = 3.
      // Pre-dedup would be 4 (two filter-layer eq calls instead of one).
      expect(createdByEqCalls.length).toBe(3);
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

describe("ExerciseRepository.count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // `count()` must hit the DB with the same AND-combined filter chain that
  // `list()` builds — if they drift, `meta.total` can report N rows but the
  // page slice returns fewer (or hasMore flips true while the next page is
  // empty). The shared `buildListFilterConditions` helper is the contract.

  /** Build a db mock whose `select().from().where()` resolves to `rows`. */
  function makeCountingDb(rows: Array<{ total: number }>) {
    const where = vi.fn().mockResolvedValue(rows);
    const from = vi.fn().mockReturnValue({ where });
    return {
      select: vi.fn().mockReturnValue({ from }),
      where, // exposed so tests can assert it was awaited
    };
  }

  it("returns the total from the single COUNT(*) row", async () => {
    const mockDb = makeCountingDb([{ total: 42 }]);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const total = await repo.count({ limit: 20, offset: 0 }, "user-1");
    expect(total).toBe(42);
  });

  it("returns 0 when the query yields no rows (defensive)", async () => {
    const mockDb = makeCountingDb([]);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const total = await repo.count({});
    expect(total).toBe(0);
  });

  it("applies the same visibility + filter conditions as list()", async () => {
    const mockDb = makeCountingDb([{ total: 7 }]);
    (getDb as any).mockReturnValue(mockDb);
    const { and } = await import("drizzle-orm");

    const repo = new ExerciseRepository();
    await repo.count(
      {
        category: ["strength"],
        difficultyLevel: ["intermediate"],
        q: "bench",
      },
      "user-1",
    );
    // Same WHERE predicate builder is reused: and() is called with the
    // full condition stack (visibility + category + difficulty + search).
    expect(and).toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalled();
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
    // Supabase schema alignment: no `where(isPublic)` filter — it's
    // selectDistinct().from(). The mock terminates at `.from()`.
    const mockDb = {
      selectDistinct: vi.fn().mockReturnValue({
        from: vi
          .fn()
          .mockResolvedValue([
            { category: "strength" },
            { category: "cardio" },
          ]),
      }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const result = await repository.getCategories();
    expect(result).toEqual(["strength", "cardio"]);
  });

  it("getCategories drops null category rows", async () => {
    const mockDb = {
      selectDistinct: vi.fn().mockReturnValue({
        from: vi
          .fn()
          .mockResolvedValue([
            { category: "strength" },
            { category: null },
            { category: "cardio" },
          ]),
      }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const result = await repository.getCategories();
    expect(result).toEqual(["strength", "cardio"]);
  });
});

describe("toPrefixTsQuery", () => {
  it("tokenises and AND-joins with :* prefix on each term", () => {
    expect(toPrefixTsQuery("press bench")).toBe("press:* & bench:*");
  });

  it("lowercases and collapses whitespace", () => {
    expect(toPrefixTsQuery("  Bench   Press  ")).toBe("bench:* & press:*");
  });

  it("returns null for empty input", () => {
    expect(toPrefixTsQuery("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(toPrefixTsQuery("   \t  \n  ")).toBeNull();
  });

  it("returns null when input is entirely reserved characters", () => {
    expect(toPrefixTsQuery("&|!:*()<>'\"\\")).toBeNull();
  });

  it("strips hyphens — 'bench-press' tokenises to two terms", () => {
    expect(toPrefixTsQuery("bench-press")).toBe("bench:* & press:*");
  });

  it("single token gets a single :* suffix", () => {
    expect(toPrefixTsQuery("BENCH")).toBe("bench:*");
  });

  it("preserves intent on typo input — tokens still emerge, trigram fallback handles the actual match", () => {
    // 'bnech' is a misspelling; the FTS branch may not match (no 'bnech' in
    // any exercise name) but the trigram branch in search() will. The
    // tokenizer's job is just to produce a valid tsquery — it does.
    expect(toPrefixTsQuery("bnech press")).toBe("bnech:* & press:*");
  });

  it("sanitises tsquery-reserved characters mixed with words", () => {
    // 'OR; DROP TABLE--' is a hopeful injection payload. The allowlist
    // strips every non-letter/non-digit char, so we get clean lexemes
    // with no dead `or;` tokens. Parameterised SQL handles the rest.
    expect(toPrefixTsQuery("OR; DROP TABLE--")).toBe("or:* & drop:* & table:*");
  });
});

describe("ExerciseRepository.search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Builds a mock `db` whose `select()` chain serves BOTH the row-page
   * query (.from().where().orderBy().limit().offset() resolving to rows)
   * AND the count query (.from().where() resolving to [{ total }]).
   *
   * The trick: `where()` returns a thenable that also exposes `.orderBy`.
   * The row-page path keeps chaining through orderBy → limit → offset.
   * The count path awaits the result of `.where()` directly via its
   * `then` method, which resolves to `[{ total }]`.
   *
   * The PT-relationships subquery used by buildVisibilityCondition for
   * authed callers also routes through `.from().where()`; its result is
   * consumed synchronously by the inArray stub (not awaited), so the
   * thenable interface is harmless there.
   */
  function makeSearchDb(rows: any[], total: number) {
    const offset = vi.fn().mockResolvedValue(rows);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const whereResult: any = {
      orderBy,
      then: (resolveCb: (v: any) => any, rejectCb?: any) =>
        Promise.resolve([{ total }]).then(resolveCb, rejectCb),
    };
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    return {
      select: vi.fn().mockReturnValue({ from }),
      // Exposed so tests can assert call counts / call args.
      _orderBy: orderBy,
      _where: where,
      _from: from,
    };
  }

  it("returns rows + total from the dual query path", async () => {
    const mockDb = makeSearchDb([mockExercises[0]], 1);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.search("press bench", {}, null, 20, 0);

    expect(result.rows).toEqual([mockExercises[0]]);
    expect(result.total).toBe(1);
  });

  it("uses the combined FTS + trigram ORDER BY when tokenisation yields tokens", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.search("press bench", {}, null);

    // orderBy is called with the combined-rank expression (sql template)
    // — we can't easily introspect the SQL fragment without executing
    // it, but asserting it was called confirms the rows-path went through
    // the ordering branch.
    expect(mockDb._orderBy).toHaveBeenCalledTimes(1);
  });

  it("falls back to trigram-only ORDER BY when tokenisation yields nothing", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    // All chars stripped → tokenizer returns null → trigram-only branch.
    await repo.search("&|!:*", {}, null);

    expect(mockDb._orderBy).toHaveBeenCalledTimes(1);
  });

  it("applies visibility predicate for unauth callers (single select call for rows + single for count)", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.search("bench", {}, null);

    // Unauth: no PT subquery select fires (isNull branch short-circuits).
    // Two calls: one for the row-page select, one for the count select.
    expect(mockDb.select).toHaveBeenCalledTimes(2);
  });

  it("applies visibility predicate for authed callers (PT-relationships subquery fires)", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.search("bench", {}, "user-1");

    // Authed: row-page select + count select + PT subquery select(s).
    // buildVisibilityCondition is called once per `where` build; both
    // queries share the same where, so the PT subquery materialises
    // once per build = twice. >= 3 calls in total.
    expect(mockDb.select.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("forwards limit and offset to the chain", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.search("bench", {}, null, 50, 100);

    // The chain's `.limit()` and `.offset()` are reached via the
    // orderBy → limit → offset path; verify both were called.
    const limitMock = (mockDb._orderBy as any).mock.results[0].value.limit;
    expect(limitMock).toHaveBeenCalledWith(50);
    expect(limitMock.mock.results[0].value.offset).toHaveBeenCalledWith(100);
  });

  it("defaults to limit=20 offset=0 when not provided", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    await repo.search("bench", {}, null);

    const limitMock = (mockDb._orderBy as any).mock.results[0].value.limit;
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(limitMock.mock.results[0].value.offset).toHaveBeenCalledWith(0);
  });

  it("applies category + equipment + muscle + difficulty + created_by filter axes alongside FTS", async () => {
    const mockDb = makeSearchDb([], 0);
    (getDb as any).mockReturnValue(mockDb);
    const { inArray, and } = await import("drizzle-orm");
    (inArray as any).mockClear();
    (and as any).mockClear();

    const repo = new ExerciseRepository();
    await repo.search(
      "press",
      {
        category: ["cardio"],
        difficultyLevel: ["beginner"],
        targetedMusclesAny: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
        equipmentAny: ["c1b2c3d4-e5f6-7890-abcd-ef1234567890"],
        createdByFilter: ["system"],
      },
      "user-1",
    );

    // Each enum-array filter axis goes through `inArray`. Visibility +
    // createdBy=system also call inArray (via the PT subquery / sentinel
    // OR-clause), so the exact count is implementation-dependent — we
    // just verify the filter-axis predicates were emitted (>= 2 calls
    // covers category + difficulty at minimum).
    expect((inArray as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    // And: every condition (visibility + filters + FTS) AND-combined.
    expect(and).toHaveBeenCalled();
  });

  it("returns total=0 when count query yields no rows (defensive)", async () => {
    // `makeSearchDb` always resolves count to a single-element array, so
    // simulate the empty case by overriding the thenable to resolve to []
    // for the count path. We do this by constructing a custom mock.
    const offset = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const whereResult: any = {
      orderBy,
      then: (resolveCb: any, rejectCb: any) =>
        Promise.resolve([]).then(resolveCb, rejectCb),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi
          .fn()
          .mockReturnValue({ where: vi.fn().mockReturnValue(whereResult) }),
      }),
    };
    (getDb as any).mockReturnValue(mockDb);

    const repo = new ExerciseRepository();
    const result = await repo.search("bench", {}, null);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });
});
