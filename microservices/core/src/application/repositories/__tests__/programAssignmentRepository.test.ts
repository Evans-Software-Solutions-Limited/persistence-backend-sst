/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { ProgramAssignmentRepository } from "../programAssignmentRepository";

const TRAINER = "trainer-1";
const CLIENT = "client-1";
const TODAY = "2026-07-03";

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
  const onConflictCalls: unknown[] = [];
  const db: any = {
    insertedValues,
    onConflictCalls,
    select: vi.fn(() => selectResult(() => selects[s++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: unknown) => {
        const res = insertResults[i++] ?? [];
        if (res instanceof Error) throw res;
        insertedValues.push(vals);
        return {
          returning: vi.fn().mockResolvedValue(res),
          onConflictDoNothing: vi.fn(() => {
            onConflictCalls.push(vals);
            return Promise.resolve(undefined);
          }),
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

const finiteProgram = { id: "prog-1", durationWeeks: 2, daysPerWeek: 3 };
const indefiniteProgram = { id: "prog-1", durationWeeks: null, daysPerWeek: 2 };
const cycleAB = [{ workoutId: "w-a" }, { workoutId: "w-b" }];
const assignmentRow = {
  id: "pa-1",
  programId: "prog-1",
  clientId: CLIENT,
  assignedBy: TRAINER,
  startDate: TODAY,
  endDate: "2026-07-16",
  status: "assigned",
  showInPlan: true,
  showInLibrary: true,
};

describe("ProgramAssignmentRepository", () => {
  const repo = new ProgramAssignmentRepository();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assign", () => {
    it("not_found for a missing or un-owned programme", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.assign(
          TRAINER,
          "prog-1",
          { clientId: CLIENT, startDate: TODAY },
          TODAY,
        ),
      ).toEqual({ error: "not_found" });
    });

    it("empty_program when the cycle has no workouts", async () => {
      const db = makeDb({ selects: [[finiteProgram], []] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.assign(
          TRAINER,
          "prog-1",
          { clientId: CLIENT, startDate: TODAY },
          TODAY,
        ),
      ).toEqual({ error: "empty_program" });
    });

    it("already_assigned when a live assignment exists (pre-check)", async () => {
      const db = makeDb({
        selects: [[finiteProgram], cycleAB, [{ id: "pa-existing" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.assign(
          TRAINER,
          "prog-1",
          { clientId: CLIENT, startDate: TODAY },
          TODAY,
        ),
      ).toEqual({ error: "already_assigned" });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("already_assigned when a concurrent duplicate trips the partial unique index", async () => {
      const raceError = Object.assign(new Error("duplicate key"), {
        code: "23505",
      });
      const db = makeDb({
        selects: [[finiteProgram], cycleAB, []],
        insertResults: [raceError],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.assign(
          TRAINER,
          "prog-1",
          { clientId: CLIENT, startDate: TODAY },
          TODAY,
        ),
      ).toEqual({ error: "already_assigned" });
    });

    it("rethrows non-unique-violation insert errors", async () => {
      const dbError = Object.assign(new Error("boom"), { code: "57014" });
      const db = makeDb({
        selects: [[finiteProgram], cycleAB, []],
        insertResults: [dbError],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await expect(
        repo.assign(
          TRAINER,
          "prog-1",
          { clientId: CLIENT, startDate: TODAY },
          TODAY,
        ),
      ).rejects.toThrow("boom");
    });

    it("finite: materialises the full weeks × days set with end_date stored", async () => {
      const db = makeDb({
        selects: [[finiteProgram], cycleAB, []],
        insertResults: [[assignmentRow], []],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.assign(
        TRAINER,
        "prog-1",
        { clientId: CLIENT, startDate: TODAY },
        TODAY,
      );
      expect(out).toEqual({ assignment: assignmentRow });

      // Assignment insert carries the derived end date (2 weeks − 1 day).
      expect(db.insertedValues[0]).toMatchObject({
        programId: "prog-1",
        clientId: CLIENT,
        assignedBy: TRAINER,
        startDate: TODAY,
        endDate: "2026-07-16",
        status: "assigned",
        showInPlan: true,
        showInLibrary: true,
      });

      // 2 weeks × 3/wk = 6 occurrences cycling A/B with spread due dates.
      const occ = db.insertedValues[1] as any[];
      expect(occ).toHaveLength(6);
      expect(occ.map((o) => o.workoutId)).toEqual([
        "w-a",
        "w-b",
        "w-a",
        "w-b",
        "w-a",
        "w-b",
      ]);
      expect(occ.map((o) => o.dueDate)).toEqual([
        "2026-07-03",
        "2026-07-05",
        "2026-07-08",
        "2026-07-10",
        "2026-07-12",
        "2026-07-15",
      ]);
      expect(occ.map((o) => o.occurrenceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(
        occ.every(
          (o) =>
            o.programAssignmentId === "pa-1" &&
            o.trainerId === TRAINER &&
            o.clientId === CLIENT &&
            o.assignedDate === TODAY &&
            o.status === "assigned",
        ),
      ).toBe(true);
    });

    it("indefinite: materialises only the 28-day horizon and propagates visibility flags", async () => {
      const indefAssignment = {
        ...assignmentRow,
        endDate: null,
        showInPlan: false,
      };
      const db = makeDb({
        selects: [[indefiniteProgram], cycleAB, []],
        insertResults: [[indefAssignment], []],
      });
      vi.mocked(getDb).mockReturnValue(db);

      const out = await repo.assign(
        TRAINER,
        "prog-1",
        {
          clientId: CLIENT,
          startDate: TODAY,
          showInPlan: false,
          showInLibrary: true,
        },
        TODAY,
      );
      expect(out).toEqual({ assignment: indefAssignment });
      expect(db.insertedValues[0]).toMatchObject({
        endDate: null,
        showInPlan: false,
        showInLibrary: true,
      });

      const occ = db.insertedValues[1] as any[];
      expect(occ.length).toBeGreaterThan(0);
      // Every due date within start..start+28d; flags copied onto occurrences.
      expect(
        occ.every((o) => o.dueDate <= "2026-07-31" && o.showInPlan === false),
      ).toBe(true);
    });
  });

  describe("unassign", () => {
    it("not_found when the assignment is missing, un-owned, or already terminal", async () => {
      const db = makeDb({ updateResults: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.unassign(TRAINER, "prog-1", "pa-1", TODAY)).toBe(
        "not_found",
      );
      expect(db.delete).not.toHaveBeenCalled();
    });

    it("marks skipped and prunes future untouched occurrences", async () => {
      const db = makeDb({
        updateResults: [[{ ...assignmentRow, status: "skipped" }]],
        deleteResults: [[]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.unassign(TRAINER, "prog-1", "pa-1", TODAY)).toBe(
        "unassigned",
      );
      expect(db.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("ensureMaterializedForClient", () => {
    it("no live indefinite assignments → no writes", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.ensureMaterializedForClient(CLIENT, TODAY);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("tops up from maxIndex+1 with conflict-tolerant inserts", async () => {
      const db = makeDb({
        selects: [
          [
            {
              id: "pa-1",
              programId: "prog-1",
              assignedBy: TRAINER,
              startDate: "2026-06-05", // 4 weeks before TODAY
              showInPlan: true,
              showInLibrary: false,
              daysPerWeek: 2,
              maxIndex: 7,
            },
          ],
          cycleAB,
        ],
        insertResults: [[]],
      });
      vi.mocked(getDb).mockReturnValue(db);

      await repo.ensureMaterializedForClient(CLIENT, TODAY);

      // Insert went through the ON CONFLICT DO NOTHING path.
      expect(db.onConflictCalls).toHaveLength(1);
      const occ = db.onConflictCalls[0] as any[];
      expect(occ[0].occurrenceIndex).toBe(8);
      expect(occ.every((o, idx) => o.occurrenceIndex === 8 + idx)).toBe(true);
      // Horizon-bounded: nothing due after today + 28d.
      expect(occ.every((o) => o.dueDate <= "2026-07-31")).toBe(true);
      // Assignment-level visibility flags copied onto new occurrences.
      expect(occ.every((o) => o.showInLibrary === false)).toBe(true);
      // assignedDate is the top-up day, not the programme start.
      expect(occ.every((o) => o.assignedDate === TODAY)).toBe(true);
    });

    it("fresh assignment with no occurrences starts from index 0", async () => {
      const db = makeDb({
        selects: [
          [
            {
              id: "pa-1",
              programId: "prog-1",
              assignedBy: TRAINER,
              startDate: TODAY,
              showInPlan: true,
              showInLibrary: true,
              daysPerWeek: 1,
              maxIndex: null,
            },
          ],
          cycleAB,
        ],
        insertResults: [[]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.ensureMaterializedForClient(CLIENT, TODAY);
      const occ = db.onConflictCalls[0] as any[];
      expect(occ[0].occurrenceIndex).toBe(0);
    });

    it("skips assignments whose programme cycle is empty", async () => {
      const db = makeDb({
        selects: [
          [
            {
              id: "pa-1",
              programId: "prog-1",
              assignedBy: TRAINER,
              startDate: TODAY,
              showInPlan: true,
              showInLibrary: true,
              daysPerWeek: 3,
              maxIndex: null,
            },
          ],
          [],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.ensureMaterializedForClient(CLIENT, TODAY);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe("getActiveProgrammeForClient", () => {
    it("null when nothing live or plan-visible", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.getActiveProgrammeForClient(CLIENT, TODAY)).toBeNull();
    });

    it("maps the live programme with a derived week", async () => {
      const db = makeDb({
        selects: [
          [
            {
              assignmentId: "pa-1",
              programId: "prog-1",
              name: "Strength 4wk",
              durationWeeks: 4,
              startDate: "2026-06-26",
              endDate: "2026-07-23",
              assignedByName: "Bradley Evans",
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.getActiveProgrammeForClient(CLIENT, TODAY)).toEqual({
        assignmentId: "pa-1",
        programId: "prog-1",
        name: "Strength 4wk",
        week: 2,
        totalWeeks: 4,
        endDate: "2026-07-23",
        startDate: "2026-06-26",
        assignedByName: "Bradley Evans",
      });
    });

    it("null-safes the coach name when the trainer profile has none", async () => {
      const db = makeDb({
        selects: [
          [
            {
              assignmentId: "pa-1",
              programId: "prog-1",
              name: "Strength 4wk",
              durationWeeks: 4,
              startDate: "2026-06-26",
              endDate: "2026-07-23",
              assignedByName: null,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.getActiveProgrammeForClient(CLIENT, TODAY);
      expect(out?.assignedByName).toBeNull();
    });

    it("indefinite programme reports null totalWeeks/endDate", async () => {
      const db = makeDb({
        selects: [
          [
            {
              assignmentId: "pa-1",
              programId: "prog-1",
              name: "Ongoing Cut",
              durationWeeks: null,
              startDate: "2026-06-05",
              endDate: null,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.getActiveProgrammeForClient(CLIENT, TODAY);
      expect(out).toMatchObject({ week: 5, totalWeeks: null, endDate: null });
    });
  });

  describe("linkCompletedSession", () => {
    it("no open occurrence for the workout → no-op", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("ad-hoc occurrence (no programme linkage): completes the row, no parent queries", async () => {
      const db = makeDb({
        selects: [[{ id: "wa-1", programAssignmentId: null }]],
        updateResults: [[{ id: "wa-1" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      expect(db.update).toHaveBeenCalledTimes(1);
      // Only the candidate select ran — no parent/remaining queries.
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("retry / concurrent replay: occurrence already completed → stops after the guarded update", async () => {
      const db = makeDb({
        selects: [[{ id: "wa-1", programAssignmentId: "pa-1" }]],
        updateResults: [[]], // guarded UPDATE matched nothing
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it("first completion promotes the parent assigned → started", async () => {
      const db = makeDb({
        selects: [
          [{ id: "wa-1", programAssignmentId: "pa-1" }],
          [{ id: "pa-1", status: "assigned", durationWeeks: 4 }],
          [{ remaining: 11 }],
        ],
        updateResults: [[{ id: "wa-1" }], [{ id: "pa-1" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      expect(db.update).toHaveBeenCalledTimes(2);
    });

    it("final occurrence of a FINITE programme completes the parent", async () => {
      const db = makeDb({
        selects: [
          [{ id: "wa-12", programAssignmentId: "pa-1" }],
          [{ id: "pa-1", status: "started", durationWeeks: 4 }],
          [{ remaining: 0 }],
        ],
        updateResults: [[{ id: "wa-12" }], [{ id: "pa-1" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      expect(db.update).toHaveBeenCalledTimes(2);
    });

    it("INDEFINITE programme never auto-completes between top-ups", async () => {
      const db = makeDb({
        selects: [
          [{ id: "wa-8", programAssignmentId: "pa-1" }],
          [{ id: "pa-1", status: "started", durationWeeks: null }],
          [{ remaining: 0 }], // window exhausted, but the programme is ongoing
        ],
        updateResults: [[{ id: "wa-8" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      await repo.linkCompletedSession(CLIENT, "w-a", "sess-1", db);
      // Occurrence update only — parent stays `started`.
      expect(db.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("createAdHoc", () => {
    it("rejects a workout the trainer cannot read", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.createAdHoc(
        TRAINER,
        CLIENT,
        { workoutId: "w-x" },
        TODAY,
      );
      expect(out).toEqual({ error: "invalid_workout" });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("creates an un-linked assignment row with defaults", async () => {
      const row = { id: "wa-1", trainerId: TRAINER, clientId: CLIENT };
      const db = makeDb({
        selects: [[{ id: "w-a" }]],
        insertResults: [[row]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.createAdHoc(
        TRAINER,
        CLIENT,
        { workoutId: "w-a", dueDate: "2026-07-10", trainerNotes: "Focus form" },
        TODAY,
      );
      expect(out).toEqual({ assignment: row });
      expect(db.insertedValues[0]).toMatchObject({
        trainerId: TRAINER,
        clientId: CLIENT,
        workoutId: "w-a",
        assignedDate: TODAY,
        dueDate: "2026-07-10",
        status: "assigned",
        trainerNotes: "Focus form",
        showInPlan: true,
        showInLibrary: true,
      });
      // No programme linkage on ad-hoc rows.
      expect((db.insertedValues[0] as any).programAssignmentId).toBeUndefined();
    });
  });

  describe("deleteAdHoc", () => {
    it("deletes an untouched ad-hoc row and returns the deleted assignment", async () => {
      const db = makeDb({
        deleteResults: [[{ id: "wa-1", workoutId: "w-1", dueDate: null }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.deleteAdHoc(TRAINER, CLIENT, "wa-1")).toEqual({
        result: "deleted",
        assignment: { id: "wa-1", workoutId: "w-1", dueDate: null },
      });
    });

    it("not_found when no row matches at all", async () => {
      const db = makeDb({ deleteResults: [[]], selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.deleteAdHoc(TRAINER, CLIENT, "wa-x")).toEqual({
        result: "not_found",
      });
    });

    it("not_deletable when the row exists but is completed or programme-linked", async () => {
      const db = makeDb({
        deleteResults: [[]],
        selects: [[{ id: "wa-1" }]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.deleteAdHoc(TRAINER, CLIENT, "wa-1")).toEqual({
        result: "not_deletable",
      });
    });

    it("threads an explicit tx handle through instead of calling getDb()", async () => {
      const txDb = makeDb({
        deleteResults: [
          [{ id: "wa-2", workoutId: "w-2", dueDate: "2026-07-10" }],
        ],
      });
      vi.mocked(getDb).mockReturnValue(makeDb({}));
      const result = await repo.deleteAdHoc(
        TRAINER,
        CLIENT,
        "wa-2",
        txDb as any,
      );
      expect(result).toEqual({
        result: "deleted",
        assignment: { id: "wa-2", workoutId: "w-2", dueDate: "2026-07-10" },
      });
      expect(txDb.delete).toHaveBeenCalled();
    });
  });

  describe("listOpenAssignmentsForClient", () => {
    it("maps rows to concrete assignments (ad-hoc vs occurrence, swapped flag)", async () => {
      const db = makeDb({
        selects: [
          [
            {
              assignmentId: "wa-1",
              workoutId: "w-1",
              name: "Push",
              estimatedDurationMinutes: 45,
              dueDate: "2026-07-10",
              status: "assigned",
              programAssignmentId: null,
              occurrenceIndex: null,
              swappedFromWorkoutId: null,
            },
            {
              assignmentId: "wa-2",
              workoutId: "w-2",
              name: "Pull",
              estimatedDurationMinutes: null,
              dueDate: "2026-07-11",
              status: "assigned",
              programAssignmentId: "pa-1",
              occurrenceIndex: 3,
              swappedFromWorkoutId: "w-orig",
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.listOpenAssignmentsForClient(TRAINER, CLIENT);
      expect(out).toEqual([
        {
          assignmentId: "wa-1",
          workoutId: "w-1",
          name: "Push",
          estimatedDurationMinutes: 45,
          dueDate: "2026-07-10",
          status: "assigned",
          isProgrammeOccurrence: false,
          occurrenceIndex: null,
          isSwapped: false,
        },
        {
          assignmentId: "wa-2",
          workoutId: "w-2",
          name: "Pull",
          estimatedDurationMinutes: null,
          dueDate: "2026-07-11",
          status: "assigned",
          isProgrammeOccurrence: true,
          occurrenceIndex: 3,
          isSwapped: true,
        },
      ]);
    });

    it("returns [] when the client has no open assignments", async () => {
      const db = makeDb({ selects: [[]] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(await repo.listOpenAssignmentsForClient(TRAINER, CLIENT)).toEqual(
        [],
      );
    });
  });

  describe("swapAssignment", () => {
    it("invalid_workout when the replacement isn't the trainer's own or public", async () => {
      const db = makeDb({ selects: [[]] }); // readability check misses
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-new"),
      ).toEqual({ result: "invalid_workout" });
    });

    it("not_found when the assignment doesn't exist for this trainer+client", async () => {
      const db = makeDb({ selects: [[{ id: "w-new" }], []] });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.swapAssignment(TRAINER, CLIENT, "wa-x", "w-new"),
      ).toEqual({ result: "not_found" });
    });

    it("not_swappable when the row exists but isn't status=assigned", async () => {
      const db = makeDb({
        selects: [
          [{ id: "w-new" }],
          [
            {
              id: "wa-1",
              workoutId: "w-old",
              status: "completed",
              swappedFromWorkoutId: null,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-new"),
      ).toEqual({ result: "not_swappable" });
    });

    it("same_workout when the replacement equals the current workout", async () => {
      const db = makeDb({
        selects: [
          [{ id: "w-old" }],
          [
            {
              id: "wa-1",
              workoutId: "w-old",
              status: "assigned",
              swappedFromWorkoutId: null,
            },
          ],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-old"),
      ).toEqual({ result: "same_workout" });
    });

    it("swaps: stamps swapped_from with the ORIGINAL on the first swap + returns fromWorkoutId", async () => {
      const db = makeDb({
        selects: [
          [{ id: "w-new" }],
          [
            {
              id: "wa-1",
              workoutId: "w-old",
              status: "assigned",
              swappedFromWorkoutId: null,
            },
          ],
        ],
        updateResults: [
          [{ id: "wa-1", workoutId: "w-new", swappedFromWorkoutId: "w-old" }],
        ],
      });
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-new");
      expect(out).toEqual({
        result: "swapped",
        assignment: {
          id: "wa-1",
          workoutId: "w-new",
          swappedFromWorkoutId: "w-old",
        },
        fromWorkoutId: "w-old",
      });
      // On the SET: preserve the true original (null → the pre-swap workout).
      expect(db.update).toHaveBeenCalled();
    });

    it("not_swappable when the guarded UPDATE matches zero rows (lost race after SELECT)", async () => {
      // SELECT sees status=assigned, but a concurrent complete/start slips in
      // → the guarded UPDATE returns []. Must NOT return a swapped result with
      // an undefined assignment (that would 500 downstream).
      const db = makeDb({
        selects: [
          [{ id: "w-new" }],
          [
            {
              id: "wa-1",
              workoutId: "w-old",
              status: "assigned",
              swappedFromWorkoutId: null,
            },
          ],
        ],
        updateResults: [[]],
      });
      vi.mocked(getDb).mockReturnValue(db);
      expect(
        await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-new"),
      ).toEqual({ result: "not_swappable" });
    });

    it("re-swap PRESERVES the existing original in swapped_from (not the intermediate)", async () => {
      const setArg = vi.fn();
      const db: any = makeDb({
        selects: [
          [{ id: "w-third" }],
          [
            {
              id: "wa-1",
              workoutId: "w-second",
              status: "assigned",
              swappedFromWorkoutId: "w-first",
            },
          ],
        ],
        updateResults: [
          [
            {
              id: "wa-1",
              workoutId: "w-third",
              swappedFromWorkoutId: "w-first",
            },
          ],
        ],
      });
      // Capture what .set() receives to prove the original is preserved.
      db.update = vi.fn(() => ({
        set: (vals: any) => {
          setArg(vals);
          return {
            where: () => ({
              returning: vi.fn().mockResolvedValue([
                {
                  id: "wa-1",
                  workoutId: "w-third",
                  swappedFromWorkoutId: "w-first",
                },
              ]),
            }),
          };
        },
      }));
      vi.mocked(getDb).mockReturnValue(db);
      const out = await repo.swapAssignment(TRAINER, CLIENT, "wa-1", "w-third");
      expect((out as any).result).toBe("swapped");
      expect((out as any).fromWorkoutId).toBe("w-second");
      expect(setArg).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutId: "w-third",
          swappedFromWorkoutId: "w-first", // preserved, NOT "w-second"
        }),
      );
    });
  });
});
