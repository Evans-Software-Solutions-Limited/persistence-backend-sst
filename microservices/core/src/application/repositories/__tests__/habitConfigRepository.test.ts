import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { HabitConfigRepository } from "../habitConfigRepository";
import {
  addDaysISO,
  localDateISO,
  periodEndForDateISO,
} from "../../streaks/period";
import { validateHabitConfigInput } from "../../habits/habitCategories";

// A fixed Wednesday for deterministic period maths.
const NOW = new Date("2026-06-24T12:00:00.000Z");
const TZ = "Europe/London";
const TODAY = localDateISO(NOW, TZ);
const NEXT_MONDAY = addDaysISO(periodEndForDateISO(TODAY, "weekly"), 1);

/**
 * Chainable drizzle mock. Each of select/insert/update draws from its own
 * FIFO queue when a chain is awaited; `values`/`set` payloads are recorded so
 * tests can assert what was written. One `await` consumes one queued result.
 */
function makeDb(opts: {
  selects?: unknown[];
  inserts?: unknown[];
  updates?: unknown[];
}) {
  const sQ = [...(opts.selects ?? [])];
  const iQ = [...(opts.inserts ?? [])];
  const uQ = [...(opts.updates ?? [])];
  const rec: { op: string; arg: unknown }[] = [];

  const chain = (queue: unknown[]) => {
    const p: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(queue.shift());
        }
        return (...args: unknown[]) => {
          if (prop === "values" || prop === "set") {
            rec.push({ op: String(prop), arg: args[0] });
          }
          return p;
        };
      },
      apply: () => p,
    });
    return p;
  };

  const db = {
    select: () => chain(sQ),
    insert: () => chain(iQ),
    update: () => chain(uQ),
  };
  return { db, rec };
}

const cfgRow = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  userId: "u1",
  goalId: "g1",
  category: "water",
  targetValue: "2",
  unit: "l",
  period: "daily",
  completionRule: "value_gte",
  daysPerWeek: 5,
  tolerancePct: null,
  effectiveFrom: NEXT_MONDAY,
  pendingConfig: null,
  pendingFrom: null,
  ...over,
});

const validWater = () => {
  const r = validateHabitConfigInput("water", {
    targetValue: 2,
    daysPerWeek: 5,
  });
  if (!r.ok) throw new Error("fixture invalid");
  return r.config;
};

beforeEach(() => vi.clearAllMocks());

describe("HabitConfigRepository.upsert", () => {
  it("first enable inserts goal + config (effective next Monday) and seeds the streak", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }], // resolveGoalTypeId
        [{ tz: TZ }], // getUserTimezone
        [], // existing goal — none
        [], // existing config — none
        [], // ensureCollectionStreak: no streak yet
      ],
      inserts: [
        [{ id: "g1", isActive: true, assignedByUserId: null }], // goal insert
        [cfgRow()], // config insert
        undefined, // streak insert
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    const view = await new HabitConfigRepository().upsert(
      "u1",
      "water",
      validWater(),
      {
        now: NOW,
      },
    );

    expect(view).not.toBeNull();
    expect(view!.enabled).toBe(true);
    expect(view!.pending).toBeNull();
    // config insert carried effective_from = next Monday, no pending
    const cfgInsert = rec.find(
      (r) =>
        r.op === "values" &&
        (r.arg as { category?: string }).category === "water",
    );
    expect((cfgInsert!.arg as { effectiveFrom: string }).effectiveFrom).toBe(
      NEXT_MONDAY,
    );
    expect((cfgInsert!.arg as { pendingFrom: unknown }).pendingFrom).toBeNull();
    // a user_streaks row was inserted (collection seed)
    const streakInsert = rec.find(
      (r) =>
        r.op === "values" &&
        (r.arg as { streakType?: string }).streakType === "habit_streak",
    );
    expect(streakInsert).toBeTruthy();
    expect(
      (streakInsert!.arg as { sourceGoalId: unknown }).sourceGoalId,
    ).toBeNull();
  });

  it("stamps assignedByUserId on a coach write", async () => {
    const { db, rec } = makeDb({
      selects: [[{ id: "gt-water" }], [{ tz: TZ }], [], [], [{ id: "s1" }]],
      inserts: [[{ id: "g1", assignedByUserId: "coach1" }], [cfgRow()]],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await new HabitConfigRepository().upsert("u1", "water", validWater(), {
      now: NOW,
      assignedByUserId: "coach1",
    });
    const goalInsert = rec.find(
      (r) => r.op === "values" && "goalTypeId" in (r.arg as object),
    );
    expect(
      (goalInsert!.arg as { assignedByUserId: string }).assignedByUserId,
    ).toBe("coach1");
  });

  it("re-enables a previously disabled goal (live write, not pending)", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ tz: TZ }],
        [{ id: "g1", isActive: false, assignedByUserId: null }], // inactive goal
        [cfgRow()], // existing config
        [{ id: "s1" }], // streak exists
      ],
      updates: [
        [{ id: "g1", isActive: true, assignedByUserId: null }], // reactivate goal
        [cfgRow({ effectiveFrom: NEXT_MONDAY })], // live config update
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    const view = await new HabitConfigRepository().upsert(
      "u1",
      "water",
      validWater(),
      {
        now: NOW,
      },
    );
    expect(view!.enabled).toBe(true);
    // a live SET carried effective_from (not a pending_from edit)
    const liveSet = rec.find(
      (r) => r.op === "set" && "effectiveFrom" in (r.arg as object),
    );
    expect(liveSet).toBeTruthy();
  });

  it("preserves coach attribution on a SELF re-enable (no null-ing)", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ tz: TZ }],
        [{ id: "g1", isActive: false, assignedByUserId: "coach1" }], // was coach-set
        [cfgRow()],
        [{ id: "s1" }],
      ],
      updates: [
        [{ id: "g1", isActive: true, assignedByUserId: "coach1" }],
        [cfgRow()],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    // Self write (no assignedByUserId) — must NOT touch the column.
    await new HabitConfigRepository().upsert("u1", "water", validWater(), {
      now: NOW,
    });
    const goalSet = rec.find(
      (r) => r.op === "set" && "isActive" in (r.arg as object),
    );
    expect(goalSet).toBeTruthy();
    expect("assignedByUserId" in (goalSet!.arg as object)).toBe(false);
  });

  it("stamps coach attribution on a COACH re-enable", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ tz: TZ }],
        [{ id: "g1", isActive: false, assignedByUserId: "coach1" }],
        [cfgRow()],
        [{ id: "s1" }],
      ],
      updates: [
        [{ id: "g1", isActive: true, assignedByUserId: "coach2" }],
        [cfgRow()],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await new HabitConfigRepository().upsert("u1", "water", validWater(), {
      now: NOW,
      assignedByUserId: "coach2",
    });
    const goalSet = rec.find(
      (r) => r.op === "set" && "isActive" in (r.arg as object),
    );
    expect(
      (goalSet!.arg as { assignedByUserId: string }).assignedByUserId,
    ).toBe("coach2");
  });

  it("edits an active habit by QUEUEING a pending change (live untouched)", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ tz: TZ }],
        [{ id: "g1", isActive: true, assignedByUserId: null }], // active goal
        [cfgRow()], // existing config
      ],
      updates: [
        [
          cfgRow({
            pendingConfig: { targetValue: 3 },
            pendingFrom: NEXT_MONDAY,
          }),
        ],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    const edit = validateHabitConfigInput("water", {
      targetValue: 3,
      daysPerWeek: 5,
    });
    if (!edit.ok) throw new Error("bad");
    const view = await new HabitConfigRepository().upsert(
      "u1",
      "water",
      edit.config,
      {
        now: NOW,
      },
    );

    const pendingSet = rec.find((r) => r.op === "set");
    expect((pendingSet!.arg as { pendingFrom: string }).pendingFrom).toBe(
      NEXT_MONDAY,
    );
    expect(
      (pendingSet!.arg as { pendingConfig: { targetValue: number } })
        .pendingConfig.targetValue,
    ).toBe(3);
    expect(view!.pending).not.toBeNull();
    expect(view!.pending!.from).toBe(NEXT_MONDAY);
  });

  it("returns null for an unknown / unseeded category", async () => {
    const { db } = makeDb({ selects: [[]] }); // resolveGoalTypeId → none
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const view = await new HabitConfigRepository().upsert(
      "u1",
      "water",
      validWater(),
      {
        now: NOW,
      },
    );
    expect(view).toBeNull();
  });
});

describe("HabitConfigRepository.disable", () => {
  it("queues a pending disable for an active habit", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ tz: TZ }],
        [{ id: "g1", isActive: true }],
      ],
      updates: [[{ id: "c1" }]],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const disabledGoalId = await new HabitConfigRepository().disable(
      "u1",
      "water",
      {
        now: NOW,
      },
    );
    // Now returns the disabled goal id (was a boolean) so the coach path can
    // audit it (18-habit-setup Phase 18.3).
    expect(disabledGoalId).toBe("g1");
    const set = rec.find((r) => r.op === "set");
    expect(
      (set!.arg as { pendingConfig: { enabled: boolean } }).pendingConfig
        .enabled,
    ).toBe(false);
    expect((set!.arg as { pendingFrom: string }).pendingFrom).toBe(NEXT_MONDAY);
  });

  it("returns null when the habit is not active / not configured", async () => {
    const { db } = makeDb({
      selects: [[{ id: "gt-water" }], [{ tz: TZ }], []], // no goal
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().disable("u1", "water", { now: NOW }),
    ).toBeNull();
  });

  it("returns null for an unknown category", async () => {
    const { db } = makeDb({ selects: [[]] });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().disable("u1", "water", { now: NOW }),
    ).toBeNull();
  });
});

describe("HabitConfigRepository.promotePendingEdits", () => {
  it("promotes a value edit into the live columns and clears pending", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ tz: TZ }], // tz
        [
          cfgRow({
            pendingConfig: { targetValue: 3, daysPerWeek: 6 },
            pendingFrom: TODAY,
          }),
        ],
      ],
      updates: [[], []], // promote update + clear update
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const n = await new HabitConfigRepository().promotePendingEdits("u1", NOW);
    expect(n).toBe(1);
    const promote = rec.find(
      (r) => r.op === "set" && "targetValue" in (r.arg as object),
    );
    expect((promote!.arg as { targetValue: string }).targetValue).toBe("3");
    expect((promote!.arg as { daysPerWeek: number }).daysPerWeek).toBe(6);
  });

  it("promotes a pending disable by flipping the goal inactive", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ tz: TZ }],
        [cfgRow({ pendingConfig: { enabled: false }, pendingFrom: TODAY })],
      ],
      updates: [[], []], // goal deactivate + clear pending
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const n = await new HabitConfigRepository().promotePendingEdits("u1", NOW);
    expect(n).toBe(1);
    const deactivate = rec.find(
      (r) =>
        r.op === "set" && (r.arg as { isActive?: boolean }).isActive === false,
    );
    expect(deactivate).toBeTruthy();
  });

  it("promotes nothing when no pending edits are due", async () => {
    const { db } = makeDb({ selects: [[{ tz: TZ }], []] });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().promotePendingEdits("u1", NOW),
    ).toBe(0);
  });
});

describe("HabitConfigRepository.listForUser / getAssigner", () => {
  it("maps configured habits to views and drops unknown categories", async () => {
    const { db } = makeDb({
      selects: [
        [
          {
            config: cfgRow(),
            goal: { isActive: true, assignedByUserId: null },
          },
          {
            config: cfgRow({ category: "legacy", goalId: "g9" }),
            goal: { isActive: true, assignedByUserId: null },
          },
        ],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const list = await new HabitConfigRepository().listForUser("u1");
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe("water");
    expect(list[0].targetValue).toBe(2);
    // Self-set habit (no assigner) → no coach attribution name.
    expect(list[0].assignedByName).toBeNull();
  });

  it("surfaces a pending edit + numeric tolerance in the view", async () => {
    const { db } = makeDb({
      selects: [
        [
          {
            config: cfgRow({
              category: "calories",
              tolerancePct: "10",
              pendingConfig: { targetValue: 2100 },
              pendingFrom: NEXT_MONDAY,
            }),
            goal: { isActive: true, assignedByUserId: "coach1" },
            assignedByName: "Coach One",
          },
        ],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const [v] = await new HabitConfigRepository().listForUser("u1");
    expect(v.tolerancePct).toBe(10);
    expect(v.assignedByUserId).toBe("coach1");
    // Coach-assigned habit → the assigning coach's name is resolved for the badge.
    expect(v.assignedByName).toBe("Coach One");
    expect(v.pending).not.toBeNull();
  });

  it("getAssigner returns the goal + assigner, or null when absent", async () => {
    const found = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ id: "g1", assignedByUserId: "coach1" }],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(found.db);
    expect(
      await new HabitConfigRepository().getAssigner("u1", "water"),
    ).toEqual({
      goalId: "g1",
      assignedByUserId: "coach1",
    });

    const none = makeDb({ selects: [[{ id: "gt-water" }], []] });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(none.db);
    expect(
      await new HabitConfigRepository().getAssigner("u1", "water"),
    ).toBeNull();

    const noType = makeDb({ selects: [[]] });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(noType.db);
    expect(
      await new HabitConfigRepository().getAssigner("u1", "water"),
    ).toBeNull();
  });
});

describe("HabitConfigRepository branch coverage", () => {
  it("upsert defaults the clock + null assigner when opts are omitted", async () => {
    const { db } = makeDb({ selects: [[]] }); // unknown category → early return
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    // No opts at all — exercises `opts.now ?? new Date()` + `?? null`.
    expect(
      await new HabitConfigRepository().upsert("u1", "water", validWater()),
    ).toBeNull();
  });

  it("disable defaults the clock when now is omitted", async () => {
    const { db } = makeDb({ selects: [[]] }); // unknown category
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(await new HabitConfigRepository().disable("u1", "water")).toBeNull();
  });

  it("falls back to Europe/London when the profile timezone row is missing", async () => {
    const { db, rec } = makeDb({
      selects: [[{ id: "gt-water" }], [], [], [], []], // tz row missing (2nd)
      inserts: [[{ id: "g1" }], [cfgRow()], undefined],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const v = await new HabitConfigRepository().upsert(
      "u1",
      "water",
      validWater(),
      {
        now: NOW,
      },
    );
    expect(v).not.toBeNull();
    const cfgInsert = rec.find(
      (r) =>
        r.op === "values" &&
        (r.arg as { category?: string }).category === "water",
    );
    expect((cfgInsert!.arg as { effectiveFrom: string }).effectiveFrom).toBe(
      NEXT_MONDAY,
    );
  });

  it("promote handles a partial pending and a null pendingConfig in one sweep", async () => {
    const { db, rec } = makeDb({
      selects: [
        [{ tz: TZ }],
        [
          cfgRow({ pendingConfig: { targetValue: 9 }, pendingFrom: TODAY }),
          cfgRow({ goalId: "g2", pendingConfig: null, pendingFrom: TODAY }),
        ],
      ],
      updates: [[], [], [], []], // 2 rows × (promote/keep + clear)
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const n = await new HabitConfigRepository().promotePendingEdits("u1", NOW);
    expect(n).toBe(2);
    const promote = rec.find(
      (r) =>
        r.op === "set" &&
        (r.arg as { targetValue?: string }).targetValue === "9",
    );
    expect(promote).toBeTruthy();
  });

  it("isHabitCoachLocked: locked when assigned + active relationship", async () => {
    const { db } = makeDb({
      selects: [
        [{ id: "gt-water" }], // resolveGoalTypeId (via getAssigner)
        [{ id: "g1", assignedByUserId: "coach1" }], // goal
        [{ id: "rel1" }], // active pt_client_relationship
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().isHabitCoachLocked("u1", "water"),
    ).toBe(true);
  });

  it("isHabitCoachLocked: unlocked when no active relationship", async () => {
    const { db } = makeDb({
      selects: [
        [{ id: "gt-water" }],
        [{ id: "g1", assignedByUserId: "coach1" }],
        [], // relationship inactive / ended → lock lifts
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().isHabitCoachLocked("u1", "water"),
    ).toBe(false);
  });

  it("isHabitCoachLocked: false for a self-set habit (no assigner)", async () => {
    const { db } = makeDb({
      selects: [[{ id: "gt-water" }], [{ id: "g1", assignedByUserId: null }]],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().isHabitCoachLocked("u1", "water"),
    ).toBe(false);
  });

  it("isHabitCoachLocked: false when the habit goal doesn't exist", async () => {
    const { db } = makeDb({ selects: [[{ id: "gt-water" }], []] });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    expect(
      await new HabitConfigRepository().isHabitCoachLocked("u1", "water"),
    ).toBe(false);
  });

  it("toView yields null pending when pendingFrom is absent and null days for Gym", async () => {
    const { db } = makeDb({
      selects: [
        [
          {
            config: cfgRow({
              category: "gym",
              unit: "x",
              period: "weekly",
              completionRule: "count",
              daysPerWeek: null,
              pendingConfig: { targetValue: 5 },
              pendingFrom: null, // present config, no from → not a real pending
            }),
            goal: { isActive: true, assignedByUserId: null },
          },
        ],
      ],
    });
    (getDb as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const [v] = await new HabitConfigRepository().listForUser("u1");
    expect(v.daysPerWeek).toBeNull();
    expect(v.pending).toBeNull();
  });
});
