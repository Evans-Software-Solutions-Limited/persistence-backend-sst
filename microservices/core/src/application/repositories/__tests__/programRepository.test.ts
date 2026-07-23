/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { ProgramRepository } from "../programRepository";

const TRAINER = "trainer-1";
const TODAY = "2026-07-03";

/** Thenable select-chain (house pattern — cf. trainerRepository.test.ts). */
function selectResult(resolveRows: () => unknown[]) {
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of [
    "from",
    "where",
    "leftJoin",
    "innerJoin",
    "orderBy",
    "groupBy",
    "limit",
    "offset",
  ]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (resolve: (v: unknown[]) => unknown) => resolve(resolveRows());
  return builder;
}

/**
 * A db/tx stub whose select chains resolve to `selects` in resolution order,
 * inserts consume `insertResults` (an Error entry throws), updates consume
 * `updateResults`, deletes consume `deleteResults`. Inserted/updated values
 * are captured for assertions.
 */
function makeDb(opts: {
  selects?: unknown[][];
  insertResults?: (unknown[] | Error)[];
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
}) {
  const {
    selects = [],
    insertResults = [],
    updateResults = [],
    deleteResults = [],
  } = opts;
  let s = 0;
  let i = 0;
  let u = 0;
  let d = 0;
  const insertedValues: unknown[] = [];
  const db: any = {
    insertedValues,
    select: vi.fn(() => selectResult(() => selects[s++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        const res = insertResults[i++] ?? [];
        if (res instanceof Error) throw res;
        insertedValues.push(vals);
        return {
          returning: vi.fn().mockResolvedValue(res),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          then: (resolve: (v: unknown) => unknown) => resolve(undefined),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(updateResults[u++] ?? []),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        const res = deleteResults[d++] ?? [];
        return {
          returning: vi.fn().mockResolvedValue(res),
          then: (resolve: (v: unknown) => unknown) => resolve(res),
        };
      }),
    })),
  };
  db.transaction = vi.fn(async (fn: any) => fn(db));
  return db;
}

const programRow = {
  id: "prog-1",
  name: "Strength 4wk",
  description: "Linear",
  durationWeeks: 4,
  daysPerWeek: 3,
  createdBy: TRAINER,
  isPublic: false,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-02T00:00:00Z"),
};

describe("ProgramRepository", () => {
  const repo = new ProgramRepository();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("maps aggregate rows and serialises timestamps", async () => {
      const db = makeDb({
        selects: [
          [
            {
              id: "prog-1",
              name: "Strength 4wk",
              description: null,
              durationWeeks: 4,
              daysPerWeek: 3,
              createdAt: new Date("2026-07-01T00:00:00Z"),
              updatedAt: null,
              workoutCount: 3,
              activeClientCount: 2,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.list(TRAINER);
      expect(out).toEqual([
        {
          id: "prog-1",
          name: "Strength 4wk",
          description: null,
          durationWeeks: 4,
          daysPerWeek: 3,
          workoutCount: 3,
          activeClientCount: 2,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: null,
        },
      ]);
    });
  });

  describe("get", () => {
    it("returns null when the programme is missing or un-owned", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.get(TRAINER, "nope", TODAY)).toBeNull();
    });

    it("assembles detail: ordered structure, assignment weeks, live count", async () => {
      const db = makeDb({
        selects: [
          [programRow],
          [
            {
              id: "pw-1",
              workoutId: "w-a",
              position: 0,
              name: "Push",
              estimatedDurationMinutes: 45,
            },
            {
              id: "pw-2",
              workoutId: "w-b",
              position: 1,
              name: "Pull",
              estimatedDurationMinutes: null,
            },
          ],
          [
            {
              id: "pa-1",
              clientId: "client-1",
              clientName: "Emma Chen",
              avatarUrl: null,
              startDate: "2026-06-26", // 7 days before TODAY → week 2
              endDate: "2026-07-23",
              status: "started",
            },
            {
              id: "pa-2",
              clientId: "client-2",
              clientName: null,
              avatarUrl: "http://x/y.png",
              startDate: "2026-07-03",
              endDate: "2026-07-30",
              status: "skipped",
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.get(TRAINER, "prog-1", TODAY);
      expect(out).not.toBeNull();
      expect(out!.workoutCount).toBe(2);
      // Only the live (started) assignment counts as active.
      expect(out!.activeClientCount).toBe(1);
      expect(out!.workouts.map((w) => w.workoutId)).toEqual(["w-a", "w-b"]);
      expect(out!.assignments[0]).toMatchObject({
        clientInitials: "EC",
        currentWeek: 2,
      });
      expect(out!.assignments[1]).toMatchObject({
        clientName: "",
        clientInitials: "",
        currentWeek: 1,
      });
    });
  });

  describe("getForAthlete", () => {
    const ATHLETE = "athlete-1";

    it("returns null when the athlete has no assignment (no existence leak)", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.getForAthlete(ATHLETE, "prog-1", TODAY)).toBeNull();
      // Short-circuits before the programme lookup.
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("returns null when the programme row is missing", async () => {
      const db = makeDb({
        selects: [
          [{ startDate: "2026-06-26", endDate: null, status: "started" }],
          [],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.getForAthlete(ATHLETE, "prog-1", TODAY)).toBeNull();
    });

    it("assembles athlete detail scoped to the caller (own status + week, ordered cycle, NO other clients)", async () => {
      const db = makeDb({
        selects: [
          // assignment (7 days before TODAY → week 2)
          [
            {
              startDate: "2026-06-26",
              endDate: "2026-07-23",
              status: "started",
            },
          ],
          [programRow],
          [
            {
              id: "pw-1",
              workoutId: "w-a",
              position: 0,
              name: "Push",
              estimatedDurationMinutes: 45,
            },
            {
              id: "pw-2",
              workoutId: "w-b",
              position: 1,
              name: "Pull",
              estimatedDurationMinutes: null,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.getForAthlete(ATHLETE, "prog-1", TODAY);
      expect(out).not.toBeNull();
      expect(out!.id).toBe("prog-1");
      expect(out!.status).toBe("started");
      expect(out!.week).toBe(2);
      expect(out!.workoutCount).toBe(2);
      expect(out!.workouts.map((w) => w.workoutId)).toEqual(["w-a", "w-b"]);
      // The athlete payload must never carry other clients' assignments.
      expect(out as unknown as Record<string, unknown>).not.toHaveProperty(
        "assignments",
      );
    });
  });

  describe("create", () => {
    it("rejects a cycle containing workouts the coach cannot read", async () => {
      // Two unique ids requested; only one comes back readable.
      const db = makeDb({ selects: [[{ id: "w-a" }]] });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.create(
        TRAINER,
        {
          name: "P",
          durationWeeks: 4,
          daysPerWeek: 3,
          workoutIds: ["w-a", "w-b"],
        },
        TODAY,
      );
      expect(out).toEqual({ error: "invalid_workouts" });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("creates the programme + positioned structure (duplicates allowed)", async () => {
      const db = makeDb({
        // readable check (unique ids w-a, w-b), then fetchDetail: program,
        // structure, assignments.
        selects: [[{ id: "w-a" }, { id: "w-b" }], [programRow], [], []],
        insertResults: [[programRow], []],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.create(
        TRAINER,
        {
          name: "Strength 4wk",
          description: "Linear",
          durationWeeks: 4,
          daysPerWeek: 3,
          // w-a repeats — Push/Pull/Push.
          workoutIds: ["w-a", "w-b", "w-a"],
        },
        TODAY,
      );

      expect(out).toMatchObject({ id: "prog-1" });
      expect(db.insertedValues[0]).toMatchObject({
        name: "Strength 4wk",
        durationWeeks: 4,
        daysPerWeek: 3,
        createdBy: TRAINER,
      });
      expect(db.insertedValues[1]).toEqual([
        { programId: "prog-1", workoutId: "w-a", position: 0 },
        { programId: "prog-1", workoutId: "w-b", position: 1 },
        { programId: "prog-1", workoutId: "w-a", position: 2 },
      ]);
    });

    it("an empty cycle is a valid draft — no readability query, no structure insert", async () => {
      const db = makeDb({
        selects: [[programRow], [], []],
        insertResults: [[programRow]],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.create(
        TRAINER,
        { name: "Draft", durationWeeks: null, daysPerWeek: 2, workoutIds: [] },
        TODAY,
      );
      expect(out).toMatchObject({ id: "prog-1" });
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe("update", () => {
    it("returns null when the UPDATE matches nothing (missing or not owner)", async () => {
      const db = makeDb({ updateResults: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.update(TRAINER, "prog-1", { name: "X" }, TODAY),
      ).toBeNull();
    });

    it("metadata-only update leaves the structure alone", async () => {
      const db = makeDb({
        selects: [[programRow], [], []],
        updateResults: [[programRow]],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.update(TRAINER, "prog-1", { name: "New" }, TODAY);
      expect(out).toMatchObject({ id: "prog-1" });
      expect(db.delete).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("workoutIds replaces the structure atomically", async () => {
      const db = makeDb({
        selects: [[{ id: "w-c" }], [programRow], [], []],
        updateResults: [[programRow]],
        insertResults: [[]],
        deleteResults: [[]],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.update(
        TRAINER,
        "prog-1",
        { workoutIds: ["w-c"] },
        TODAY,
      );
      expect(out).toMatchObject({ id: "prog-1" });
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(db.insertedValues[0]).toEqual([
        { programId: "prog-1", workoutId: "w-c", position: 0 },
      ]);
    });

    it("rejects unreadable workouts before touching the row", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.update(
        TRAINER,
        "prog-1",
        { workoutIds: ["w-x"] },
        TODAY,
      );
      expect(out).toEqual({ error: "invalid_workouts" });
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("blocks while a live assignment exists", async () => {
      const db = makeDb({ selects: [[{ id: "pa-1" }]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.delete(TRAINER, "prog-1")).toBe("has_live_assignments");
      expect(db.delete).not.toHaveBeenCalled();
    });

    it("deletes when no live assignments remain", async () => {
      const db = makeDb({ selects: [[]], deleteResults: [[programRow]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.delete(TRAINER, "prog-1")).toBe("deleted");
    });

    it("not_found when the DELETE matches nothing (missing or not owner)", async () => {
      const db = makeDb({ selects: [[]], deleteResults: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.delete(TRAINER, "prog-1")).toBe("not_found");
    });
  });
});
