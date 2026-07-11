/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * A `select()` builder that is *thenable* at every chain step. Drizzle query
 * builders resolve to the row array when awaited; the repository awaits them
 * at various depths (`.where(...)`, `.limit(...)`, `.groupBy(...)`,
 * `.orderBy(...)`). Making the proxy resolve to `rows` regardless of which
 * terminal method is called keeps the mocks small.
 */
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
  // Resolve the queued row set when the builder is awaited, NOT when
  // `select()` is first called. Under `Promise.all`, every leg's synchronous
  // `select()` prefix runs before any await settles — pulling the row set at
  // await time keeps the queue aligned with *resolution* order, which is what
  // the repository's interleaved aggregates observe.
  builder.then = (resolve: (v: unknown[]) => unknown) => resolve(resolveRows());
  return builder;
}

/**
 * Build a db whose `select()` chains resolve to the queued results in
 * resolution order. Each entry is the row array a single `db.select()...`
 * chain should resolve to when awaited.
 */
function dbWithSelects(queue: unknown[][]) {
  let i = 0;
  return {
    select: vi.fn(() => selectResult(() => queue[i++] ?? [])),
  };
}

describe("TrainerRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Pure helpers ───────────────────────────────────────────────────────

  describe("pure helpers", () => {
    it("initialsFromName handles single/multi/empty", async () => {
      const { initialsFromName } = await import("../trainerRepository");
      expect(initialsFromName("Jane Smith")).toBe("JS");
      expect(initialsFromName("Cher")).toBe("CH");
      expect(initialsFromName("  ")).toBe("");
      expect(initialsFromName(null)).toBe("");
      expect(initialsFromName("a b c d")).toBe("AD");
    });

    it("adherenceBand buckets correctly", async () => {
      const { adherenceBand } = await import("../trainerRepository");
      expect(adherenceBand(90)).toBe("strong");
      expect(adherenceBand(85)).toBe("strong");
      expect(adherenceBand(84)).toBe("wobbling");
      expect(adherenceBand(65)).toBe("wobbling");
      expect(adherenceBand(64)).toBe("atRisk");
      expect(adherenceBand(0)).toBe("atRisk");
    });

    it("clientAdherence excludes zero-assignment clients", async () => {
      const { clientAdherence } = await import("../trainerRepository");
      expect(clientAdherence(0, 0)).toBeNull();
      expect(clientAdherence(1, 2)).toBe(50);
      expect(clientAdherence(3, 4)).toBe(75);
    });

    it("mean returns null for empty", async () => {
      const { mean } = await import("../trainerRepository");
      expect(mean([])).toBeNull();
      expect(mean([80, 90])).toBe(85);
    });

    it("clientRosterBand buckets all 5 levels at the thresholds", async () => {
      const { clientRosterBand } = await import("../trainerRepository");
      expect(clientRosterBand(100)).toBe("stellar");
      expect(clientRosterBand(95)).toBe("stellar");
      expect(clientRosterBand(94)).toBe("strong");
      expect(clientRosterBand(85)).toBe("strong");
      expect(clientRosterBand(84)).toBe("wobbling");
      expect(clientRosterBand(65)).toBe("wobbling");
      expect(clientRosterBand(64)).toBe("atRisk");
      expect(clientRosterBand(40)).toBe("atRisk");
      expect(clientRosterBand(39)).toBe("crisis");
      expect(clientRosterBand(0)).toBe("crisis");
    });

    it("wholeDaysBetween floors and clamps negatives to 0", async () => {
      const { wholeDaysBetween } = await import("../trainerRepository");
      const base = new Date("2026-05-15T00:00:00Z");
      expect(wholeDaysBetween(new Date("2026-05-10T00:00:00Z"), base)).toBe(5);
      // 5d 23h → floors to 5.
      expect(wholeDaysBetween(new Date("2026-05-09T01:00:00Z"), base)).toBe(5);
      // future "from" (clock skew) → 0, never negative.
      expect(wholeDaysBetween(new Date("2026-05-20T00:00:00Z"), base)).toBe(0);
    });

    it("startOfMonth / startOfQuarter / daysAgo compute UTC boundaries", async () => {
      const { startOfMonth, startOfQuarter, daysAgo } =
        await import("../trainerRepository");
      const now = new Date("2026-05-15T12:00:00Z");
      expect(startOfMonth(now).toISOString()).toBe("2026-05-01T00:00:00.000Z");
      expect(startOfQuarter(now).toISOString()).toBe(
        "2026-04-01T00:00:00.000Z",
      );
      expect(daysAgo(now, 1).toISOString()).toBe("2026-05-14T12:00:00.000Z");
      // Q1 boundary check.
      expect(
        startOfQuarter(new Date("2026-02-09T00:00:00Z")).toISOString(),
      ).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  // ─── Role guard ─────────────────────────────────────────────────────────

  describe("isTrainer", () => {
    it("returns true for personal_trainer / physiotherapist / admin", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();

      for (const role of ["personal_trainer", "physiotherapist", "admin"]) {
        (getDb as any).mockReturnValue(dbWithSelects([[{ role }]]));
        expect(await repo.isTrainer("t1")).toBe(true);
      }
    });

    it("returns false for user role or missing profile", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();

      (getDb as any).mockReturnValue(dbWithSelects([[{ role: "user" }]]));
      expect(await repo.isTrainer("u1")).toBe(false);

      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      expect(await repo.isTrainer("missing")).toBe(false);
    });
  });

  // ─── Identity / active clients / limit ──────────────────────────────────

  describe("getTrainerIdentity", () => {
    it("maps row to identity slice", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const created = new Date("2025-01-01T00:00:00Z");
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [{ fullName: "Jane Coach", email: "jane@x.io", createdAt: created }],
        ]),
      );
      const result = await repo.getTrainerIdentity("t1");
      expect(result).toEqual({
        name: "Jane Coach",
        email: "jane@x.io",
        coachSince: created.toISOString(),
      });
    });

    it("defaults missing row to empty/null", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      const result = await repo.getTrainerIdentity("t1");
      expect(result).toEqual({ name: "", email: null, coachSince: null });
    });
  });

  describe("getActiveClients", () => {
    it("maps rows, defaulting nulls", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { clientId: "c1", clientName: "A B", createdAt: null },
            { clientId: "c2", clientName: null, createdAt: null },
          ],
        ]),
      );
      const result = await repo.getActiveClients("t1");
      expect(result).toEqual([
        { clientId: "c1", clientName: "A B", createdAt: null },
        { clientId: "c2", clientName: "", createdAt: null },
      ]);
    });
  });

  describe("getRosterClients", () => {
    it("maps active+pending rows, defaulting nulls and narrowing status", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            {
              relationshipId: "rel-1",
              clientId: "c1",
              clientName: "A B",
              avatarUrl: "http://img/1",
              status: "active",
              initiatedBy: "trainer",
            },
            {
              relationshipId: "rel-2",
              clientId: "c2",
              clientName: null,
              avatarUrl: null,
              status: "pending",
              // invite-code redeem awaiting THIS coach's accept.
              initiatedBy: "client",
            },
            // null status (shouldn't happen given the WHERE) → defaults pending.
            // null initiated_by → defaults 'trainer'.
            {
              relationshipId: "rel-3",
              clientId: "c3",
              clientName: "C D",
              avatarUrl: null,
              status: null,
              initiatedBy: null,
            },
          ],
        ]),
      );
      const result = await repo.getRosterClients("t1");
      expect(result).toEqual([
        {
          relationshipId: "rel-1",
          clientId: "c1",
          clientName: "A B",
          avatarUrl: "http://img/1",
          status: "active",
          initiatedBy: "trainer",
        },
        {
          relationshipId: "rel-2",
          clientId: "c2",
          clientName: "",
          avatarUrl: null,
          status: "pending",
          initiatedBy: "client",
        },
        {
          relationshipId: "rel-3",
          clientId: "c3",
          clientName: "C D",
          avatarUrl: null,
          status: "pending",
          initiatedBy: "trainer",
        },
      ]);
    });
  });

  describe("getLastSeenByClient", () => {
    it("returns an empty map without querying for no clients", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      const result = await repo.getLastSeenByClient([]);
      expect(result.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("maps the max completedAt per client to ISO", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const seen = new Date("2026-05-12T10:00:00Z");
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { clientId: "c1", lastSeenAt: seen },
            { clientId: "c2", lastSeenAt: null },
          ],
        ]),
      );
      const result = await repo.getLastSeenByClient(["c1", "c2"]);
      expect(result.get("c1")).toBe(seen.toISOString());
      expect(result.get("c2")).toBeNull();
    });
  });

  describe("getMissedCountsByClient", () => {
    it("returns an empty map without querying for no clients", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      const result = await repo.getMissedCountsByClient(
        "t1",
        [],
        new Date(),
        new Date(),
      );
      expect(result.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("maps the missed count per client", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { clientId: "c1", missed: 2 },
            { clientId: "c2", missed: 1 },
          ],
        ]),
      );
      const result = await repo.getMissedCountsByClient(
        "t1",
        ["c1", "c2"],
        new Date("2026-04-17"),
        new Date("2026-05-15"),
      );
      expect(result.get("c1")).toBe(2);
      expect(result.get("c2")).toBe(1);
    });
  });

  describe("getClientsWithPRsThisMonth", () => {
    it("returns an empty set without querying for no clients", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      const result = await repo.getClientsWithPRsThisMonth([], new Date());
      expect(result.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("collects the distinct clients with a PR this month", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([[{ clientId: "c1" }, { clientId: "c3" }]]),
      );
      const result = await repo.getClientsWithPRsThisMonth(
        ["c1", "c2", "c3"],
        new Date("2026-05-01"),
      );
      expect(result.has("c1")).toBe(true);
      expect(result.has("c2")).toBe(false);
      expect(result.has("c3")).toBe(true);
    });
  });

  describe("getTrainerClientLimit", () => {
    it("returns the tier limit or null", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(dbWithSelects([[{ limit: 25 }]]));
      expect(await repo.getTrainerClientLimit("t1")).toBe(25);

      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      expect(await repo.getTrainerClientLimit("t1")).toBeNull();
    });
  });

  // ─── Aggregates ─────────────────────────────────────────────────────────

  describe("count helpers + retention", () => {
    it("countNewClientsThisMonth returns the count", async () => {
      const { TrainerRepository, startOfMonth } =
        await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(dbWithSelects([[{ total: 3 }]]));
      expect(
        await repo.countNewClientsThisMonth("t1", startOfMonth(new Date())),
      ).toBe(3);
      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      expect(
        await repo.countNewClientsThisMonth("t1", startOfMonth(new Date())),
      ).toBe(0);
    });

    it("countChurnThisQuarter returns the count", async () => {
      const { TrainerRepository, startOfQuarter } =
        await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(dbWithSelects([[{ total: 2 }]]));
      expect(
        await repo.countChurnThisQuarter("t1", startOfQuarter(new Date())),
      ).toBe(2);
    });

    it("getRetention computes pct, null when denominator is 0", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(dbWithSelects([[{ denom: 4, numer: 3 }]]));
      expect(await repo.getRetention("t1", new Date())).toBe(75);

      (getDb as any).mockReturnValue(dbWithSelects([[{ denom: 0, numer: 0 }]]));
      expect(await repo.getRetention("t1", new Date())).toBeNull();
    });
  });

  describe("getAdherenceRows", () => {
    it("returns [] for empty client list without querying", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      expect(
        await repo.getAdherenceRows("t1", [], new Date(), new Date()),
      ).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("maps adherence rows", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { clientId: "c1", completed: 2, total: 4 },
            { clientId: "c2", completed: 0, total: 0 },
          ],
        ]),
      );
      const rows = await repo.getAdherenceRows(
        "t1",
        ["c1", "c2"],
        new Date("2026-01-01"),
        new Date("2026-02-01"),
      );
      expect(rows).toEqual([
        { clientId: "c1", completed: 2, total: 4 },
        { clientId: "c2", completed: 0, total: 0 },
      ]);
    });
  });

  describe("getClientPRsThisMonth", () => {
    it("returns zeros for empty client list", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      expect(await repo.getClientPRsThisMonth([], new Date())).toEqual({
        count: 0,
        distinctClients: 0,
      });
      expect(db.select).not.toHaveBeenCalled();
    });

    it("returns count + distinct clients", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([[{ count: 5, distinctClients: 2 }]]),
      );
      expect(await repo.getClientPRsThisMonth(["c1"], new Date())).toEqual({
        count: 5,
        distinctClients: 2,
      });
      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      expect(await repo.getClientPRsThisMonth(["c1"], new Date())).toEqual({
        count: 0,
        distinctClients: 0,
      });
    });
  });

  describe("getProgramStats", () => {
    it("returns empty when the trainer has no programs", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      // select#1: programs → []
      (getDb as any).mockReturnValue(dbWithSelects([[]]));
      expect(await repo.getProgramStats("t1", ["c1"])).toEqual({
        activeProgramsCount: 0,
        programs: [],
      });
    });

    it("counts distinct active clients per program, top 3, with no clients", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      // select#1: programs (no second query because clientIds is empty)
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { id: "p1", name: "Prog 1" },
            { id: "p2", name: "Prog 2" },
          ],
        ]),
      );
      const result = await repo.getProgramStats("t1", []);
      expect(result.activeProgramsCount).toBe(0);
      expect(result.programs).toEqual([
        { id: "p1", name: "Prog 1", activeClients: 0 },
        { id: "p2", name: "Prog 2", activeClients: 0 },
      ]);
    });

    it("joins counts and sorts top 3", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      // select#1: programs, select#2: counts
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            { id: "p1", name: "P1" },
            { id: "p2", name: "P2" },
            { id: "p3", name: "P3" },
            { id: "p4", name: "P4" },
          ],
          [
            { programId: "p1", activeClients: 1 },
            { programId: "p2", activeClients: 5 },
            { programId: "p3", activeClients: 3 },
          ],
        ]),
      );
      const result = await repo.getProgramStats("t1", ["c1", "c2"]);
      expect(result.activeProgramsCount).toBe(3);
      expect(result.programs).toEqual([
        { id: "p2", name: "P2", activeClients: 5 },
        { id: "p3", name: "P3", activeClients: 3 },
        { id: "p1", name: "P1", activeClients: 1 },
      ]);
    });
  });

  describe("getRecentActivity", () => {
    it("returns [] for empty client list", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      expect(await repo.getRecentActivity("t1", [], new Date())).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("merges sessions / PRs / missed, sorted newest first, capped at 20", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      // select#1 sessions, #2 prs, #3 missed
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [
            {
              clientId: "c1",
              name: "Leg Day",
              completedAt: new Date("2026-05-10T10:00:00Z"),
            },
          ],
          [
            {
              clientId: "c1",
              recordType: "1rm",
              value: "100",
              achievedAt: new Date("2026-05-12T10:00:00Z"),
            },
          ],
          [{ clientId: "c1", status: "skipped", dueDate: "2026-05-08" }],
        ]),
      );
      const events = await repo.getRecentActivity(
        "t1",
        [{ clientId: "c1", clientName: "Jane Smith" }],
        new Date("2026-05-15T00:00:00Z"),
      );
      expect(events).toHaveLength(3);
      // newest first: PR (05-12), session (05-10), missed (05-08)
      expect(events[0].type).toBe("pr_achieved");
      expect(events[1].type).toBe("session_completed");
      expect(events[2].type).toBe("missed_day");
      expect(events[0].clientInitials).toBe("JS");
      expect(events[1].payload).toEqual({ sessionName: "Leg Day" });
    });

    it("handles unknown client name and null due date", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue(
        dbWithSelects([
          [],
          [],
          [{ clientId: "cX", status: "skipped", dueDate: null }],
        ]),
      );
      const events = await repo.getRecentActivity(
        "t1",
        [{ clientId: "c1", clientName: "Jane" }],
        new Date("2026-05-15T00:00:00Z"),
      );
      expect(events).toHaveLength(1);
      // clientId not in name map → empty name + initials
      expect(events[0].clientName).toBe("");
      expect(events[0].clientInitials).toBe("");
      // null due date → epoch fallback
      expect(events[0].occurredAt).toBe(new Date(0).toISOString());
    });
  });

  // ─── Overview orchestration ─────────────────────────────────────────────

  describe("getOverview", () => {
    // `getOverview` fans its sub-queries out through `Promise.all`, so the
    // raw `getDb().select()` resolution order is microtask-interleaved and
    // not positionally stable. We test the *orchestration* (the pure
    // computation that folds the sub-results into the CoachOverview shape) by
    // stubbing the already-individually-tested sub-methods. The SQL of each
    // sub-method is covered by its own test above.
    function stubOverviewMethods(
      repo: any,
      over: {
        identity: {
          name: string;
          email: string | null;
          coachSince: string | null;
        };
        clients: {
          clientId: string;
          clientName: string;
          createdAt: Date | null;
        }[];
        limit: number | null;
        newClients: number;
        churn: number;
        retention: number | null;
        adhThis: { clientId: string; completed: number; total: number }[];
        adhPrev: { clientId: string; completed: number; total: number }[];
        prs: { count: number; distinctClients: number };
        programStats: any;
        recentActivity: any[];
      },
    ) {
      vi.spyOn(repo, "getTrainerIdentity").mockResolvedValue(over.identity);
      vi.spyOn(repo, "getActiveClients").mockResolvedValue(over.clients);
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(over.limit);
      vi.spyOn(repo, "countNewClientsThisMonth").mockResolvedValue(
        over.newClients,
      );
      vi.spyOn(repo, "countChurnThisQuarter").mockResolvedValue(over.churn);
      vi.spyOn(repo, "getRetention").mockResolvedValue(over.retention);
      vi.spyOn(repo, "getAdherenceRows")
        .mockResolvedValueOnce(over.adhThis)
        .mockResolvedValueOnce(over.adhPrev);
      vi.spyOn(repo, "getClientPRsThisMonth").mockResolvedValue(over.prs);
      vi.spyOn(repo, "getProgramStats").mockResolvedValue(over.programStats);
      vi.spyOn(repo, "getRecentActivity").mockResolvedValue(
        over.recentActivity,
      );
    }

    it("assembles the full CoachOverview shape", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const coachSince = "2025-01-01T00:00:00.000Z";
      const recent = [{ type: "session_completed" }];

      stubOverviewMethods(repo, {
        identity: { name: "Jane Coach", email: "jane@x.io", coachSince },
        clients: [
          { clientId: "c1", clientName: "Al Pha", createdAt: null },
          { clientId: "c2", clientName: "Be Ta", createdAt: null },
        ],
        limit: 10,
        newClients: 1,
        churn: 0,
        retention: 100,
        // c1 90% (strong), c2 50% (atRisk)
        adhThis: [
          { clientId: "c1", completed: 9, total: 10 },
          { clientId: "c2", completed: 1, total: 2 },
        ],
        // prev mean 70%
        adhPrev: [{ clientId: "c1", completed: 7, total: 10 }],
        prs: { count: 4, distinctClients: 2 },
        programStats: {
          activeProgramsCount: 1,
          programs: [{ id: "p1", name: "Prog", activeClients: 2 }],
        },
        recentActivity: recent,
      });

      const overview = await repo.getOverview(
        "t1",
        new Date("2026-05-15T00:00:00Z"),
      );

      expect(overview.trainer).toEqual({
        name: "Jane Coach",
        initials: "JC",
        coachSince,
      });
      expect(overview.businessStats.activeClients).toBe(2);
      expect(overview.businessStats.newClientsThisMonth).toBe(1);
      expect(overview.businessStats.slotsTotal).toBe(10);
      expect(overview.businessStats.slotsOpen).toBe(8);
      // avg of 90 + 50 = 70
      expect(overview.businessStats.avgAdherence).toBe(70);
      // this 70 - prev 70 = 0
      expect(overview.businessStats.adherenceDelta).toBe(0);
      expect(overview.businessStats.clientPRsThisMonth).toBe(4);
      expect(overview.businessStats.clientsWithPRs).toBe(2);
      expect(overview.businessStats.retentionPct).toBe(100);
      expect(overview.businessStats.churnThisQuarter).toBe(0);
      expect(overview.clientHealthBreakdown).toEqual([
        { band: "strong", count: 1 },
        { band: "wobbling", count: 0 },
        { band: "atRisk", count: 1 },
      ]);
      expect(overview.programStats).toEqual({
        activeProgramsCount: 1,
        programs: [{ id: "p1", name: "Prog", activeClients: 2 }],
      });
      expect(overview.recentActivity).toEqual(recent);
    });

    it("null slots when tier unknown, null adherence/delta when no assignments", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      stubOverviewMethods(repo, {
        identity: { name: "T", email: "t@x.io", coachSince: null },
        clients: [],
        limit: null,
        newClients: 0,
        churn: 0,
        retention: null,
        adhThis: [],
        adhPrev: [],
        prs: { count: 0, distinctClients: 0 },
        programStats: { activeProgramsCount: 0, programs: [] },
        recentActivity: [],
      });
      const overview = await repo.getOverview(
        "t1",
        new Date("2026-05-15T00:00:00Z"),
      );
      expect(overview.businessStats.slotsTotal).toBeNull();
      expect(overview.businessStats.slotsOpen).toBeNull();
      expect(overview.businessStats.avgAdherence).toBeNull();
      expect(overview.businessStats.adherenceDelta).toBeNull();
      expect(overview.businessStats.retentionPct).toBeNull();
      expect(overview.recentActivity).toEqual([]);
    });

    it("uses Date.now() default and computes slotsOpen with no prev-window data", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      stubOverviewMethods(repo, {
        identity: { name: "Solo Coach", email: "s@x.io", coachSince: null },
        clients: [{ clientId: "c1", clientName: "C One", createdAt: null }],
        limit: 5,
        newClients: 0,
        churn: 1,
        retention: 50,
        adhThis: [{ clientId: "c1", completed: 3, total: 4 }], // 75%
        adhPrev: [], // no prev data → delta null
        prs: { count: 1, distinctClients: 1 },
        programStats: { activeProgramsCount: 0, programs: [] },
        recentActivity: [],
      });
      // No `now` arg → uses Date.now() default.
      const overview = await repo.getOverview("t1");
      expect(overview.businessStats.slotsTotal).toBe(5);
      expect(overview.businessStats.slotsOpen).toBe(4);
      expect(overview.businessStats.avgAdherence).toBe(75);
      expect(overview.businessStats.adherenceDelta).toBeNull();
      expect(overview.clientHealthBreakdown).toEqual([
        { band: "strong", count: 0 },
        { band: "wobbling", count: 1 },
        { band: "atRisk", count: 0 },
      ]);
    });
  });

  // ─── Clients roster orchestration ────────────────────────────────────────

  describe("getClients", () => {
    // Like getOverview, getClients fans sub-queries through Promise.all, so we
    // stub the already-individually-tested sub-methods and assert the pure
    // fold (band, flags, sort).
    function stubRoster(
      repo: any,
      over: {
        roster: {
          clientId: string;
          clientName: string;
          avatarUrl: string | null;
          status: "active" | "pending";
          initiatedBy?: "trainer" | "client";
          relationshipId?: string;
        }[];
        adherence: { clientId: string; completed: number; total: number }[];
        lastSeen: Map<string, string | null>;
        missed: Map<string, number>;
        prs: Set<string>;
      },
    ) {
      vi.spyOn(repo, "getRosterClients").mockResolvedValue(
        over.roster.map((r) => ({
          initiatedBy: "trainer" as const,
          relationshipId: `rel-${r.clientId}`,
          ...r,
        })),
      );
      vi.spyOn(repo, "getAdherenceRows").mockResolvedValue(over.adherence);
      vi.spyOn(repo, "getLastSeenByClient").mockResolvedValue(over.lastSeen);
      vi.spyOn(repo, "getMissedCountsByClient").mockResolvedValue(over.missed);
      vi.spyOn(repo, "getClientsWithPRsThisMonth").mockResolvedValue(over.prs);
    }

    it("returns [] for an empty roster without fanning out", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const getRoster = vi
        .spyOn(repo, "getRosterClients")
        .mockResolvedValue([]);
      const getAdh = vi.spyOn(repo, "getAdherenceRows");
      expect(await repo.getClients("t1")).toEqual([]);
      expect(getRoster).toHaveBeenCalledTimes(1);
      expect(getAdh).not.toHaveBeenCalled();
    });

    it("maps all 5 bands, programLabel null, sorts adherence asc with null last", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      stubRoster(repo, {
        roster: [
          {
            clientId: "stel",
            clientName: "S R",
            avatarUrl: "a",
            status: "active",
          },
          {
            clientId: "str",
            clientName: "St R",
            avatarUrl: null,
            status: "active",
          },
          {
            clientId: "wob",
            clientName: "W B",
            avatarUrl: null,
            status: "pending",
          },
          {
            clientId: "atr",
            clientName: "A R",
            avatarUrl: null,
            status: "active",
          },
          {
            clientId: "cri",
            clientName: "C I",
            avatarUrl: null,
            status: "active",
          },
          // zero in-window assignments → null adherence/band, sorts last.
          {
            clientId: "non",
            clientName: "No Ne",
            avatarUrl: null,
            status: "pending",
          },
        ],
        adherence: [
          { clientId: "stel", completed: 10, total: 10 }, // 100 → stellar
          { clientId: "str", completed: 9, total: 10 }, // 90 → strong
          { clientId: "wob", completed: 7, total: 10 }, // 70 → wobbling
          { clientId: "atr", completed: 5, total: 10 }, // 50 → atRisk
          { clientId: "cri", completed: 1, total: 10 }, // 10 → crisis
          // "non" absent → null
        ],
        lastSeen: new Map(),
        missed: new Map(),
        prs: new Set(),
      });

      const result = await repo.getClients(
        "t1",
        new Date("2026-05-15T00:00:00Z"),
      );

      // Sorted ascending by adherence; null-adherence client last.
      expect(result.map((c: any) => c.id)).toEqual([
        "cri",
        "atr",
        "wob",
        "str",
        "stel",
        "non",
      ]);
      const byId = new Map(result.map((c: any) => [c.id, c]));
      expect(byId.get("stel").band).toBe("stellar");
      expect(byId.get("str").band).toBe("strong");
      expect(byId.get("wob").band).toBe("wobbling");
      expect(byId.get("atr").band).toBe("atRisk");
      expect(byId.get("cri").band).toBe("crisis");
      expect(byId.get("non").adherence).toBeNull();
      expect(byId.get("non").band).toBeNull();
      // programLabel always null in v1; status + initials + avatar passthrough.
      expect(byId.get("stel").programLabel).toBeNull();
      expect(byId.get("stel").initials).toBe("SR");
      expect(byId.get("stel").avatarUrl).toBe("a");
      expect(byId.get("wob").status).toBe("pending");
      // No flags when none apply.
      expect(byId.get("stel").flags).toEqual([]);
    });

    it("derives NEW PR / N MISSED / Nd IDLE flags when they apply", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const now = new Date("2026-05-15T00:00:00Z");
      stubRoster(repo, {
        roster: [
          {
            clientId: "c1",
            clientName: "Al Pha",
            avatarUrl: null,
            status: "active",
          },
        ],
        adherence: [{ clientId: "c1", completed: 4, total: 10 }], // 40 → atRisk
        // last seen 6 whole days ago → "6d IDLE".
        lastSeen: new Map([["c1", "2026-05-09T00:00:00.000Z"]]),
        missed: new Map([["c1", 3]]),
        prs: new Set(["c1"]),
      });
      const result = await repo.getClients("t1", now);
      expect(result[0].flags).toEqual([
        { tone: "gold", label: "NEW PR" },
        { tone: "ember", label: "3 MISSED" },
        { tone: "error", label: "6d IDLE" },
      ]);
    });

    it("IDLE flag is inclusive at the threshold — 4d fires, 3d does not (prototype '4d IDLE')", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const now = new Date("2026-05-15T00:00:00Z");
      stubRoster(repo, {
        roster: [
          {
            clientId: "c1",
            clientName: "Four Days",
            avatarUrl: null,
            status: "active",
          },
          {
            clientId: "c2",
            clientName: "Three Days",
            avatarUrl: null,
            status: "active",
          },
        ],
        adherence: [
          { clientId: "c1", completed: 9, total: 10 },
          { clientId: "c2", completed: 9, total: 10 },
        ],
        lastSeen: new Map([
          // exactly 4 whole days ago → "4d IDLE" (inclusive threshold).
          ["c1", "2026-05-11T00:00:00.000Z"],
          // 3 whole days ago → no IDLE flag.
          ["c2", "2026-05-12T00:00:00.000Z"],
        ]),
        missed: new Map(),
        prs: new Set(),
      });
      const byId = Object.fromEntries(
        (await repo.getClients("t1", now)).map((c) => [c.id, c]),
      );
      expect(byId["c1"].flags).toEqual([{ tone: "error", label: "4d IDLE" }]);
      expect(byId["c2"].flags).toEqual([]);
    });

    it("omits each flag when it does not apply (no PR, 0 missed, recent/absent last-seen)", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const now = new Date("2026-05-15T00:00:00Z");
      stubRoster(repo, {
        roster: [
          // recently seen (2 days ago, ≤ IDLE threshold) → no IDLE flag.
          {
            clientId: "c1",
            clientName: "Al Pha",
            avatarUrl: null,
            status: "active",
          },
          // never seen (no last-seen entry) → no IDLE flag.
          {
            clientId: "c2",
            clientName: "Be Ta",
            avatarUrl: null,
            status: "active",
          },
        ],
        adherence: [
          { clientId: "c1", completed: 9, total: 10 },
          { clientId: "c2", completed: 9, total: 10 },
        ],
        lastSeen: new Map([["c1", "2026-05-13T00:00:00.000Z"]]),
        missed: new Map([["c1", 0]]), // 0 missed → no ember flag
        prs: new Set(), // no PR → no gold flag
      });
      const result = await repo.getClients("t1", now);
      for (const c of result) {
        expect(c.flags).toEqual([]);
      }
    });

    it("trainer-scopes missed via getMissedCountsByClient (co-trainer data cannot leak)", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const now = new Date("2026-05-15T00:00:00Z");
      const missedSpy = vi
        .spyOn(repo, "getMissedCountsByClient")
        .mockResolvedValue(new Map());
      vi.spyOn(repo, "getRosterClients").mockResolvedValue([
        {
          relationshipId: "rel-c1",
          clientId: "c1",
          clientName: "Al Pha",
          avatarUrl: null,
          status: "active",
          initiatedBy: "trainer",
        },
      ]);
      // Adherence query is also trainer-scoped at its own SQL level; here we
      // assert the orchestration passes trainerId + the in-window start to the
      // missed-count query so a co-trainer's assignment can't inflate the flag.
      const adhSpy = vi
        .spyOn(repo, "getAdherenceRows")
        .mockResolvedValue([{ clientId: "c1", completed: 5, total: 10 }]);
      vi.spyOn(repo, "getLastSeenByClient").mockResolvedValue(new Map());
      vi.spyOn(repo, "getClientsWithPRsThisMonth").mockResolvedValue(new Set());

      const result = await repo.getClients("t1", now);
      expect(result[0].flags).toEqual([]); // no missed → no ember flag
      expect(missedSpy).toHaveBeenCalledWith(
        "t1",
        ["c1"],
        expect.any(Date),
        now,
      );
      expect(adhSpy).toHaveBeenCalledWith("t1", ["c1"], expect.any(Date), now);
    });

    it("uses the Date.now() default when no `now` is supplied", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      stubRoster(repo, {
        roster: [
          {
            clientId: "c1",
            clientName: "Al Pha",
            avatarUrl: null,
            status: "active",
          },
        ],
        adherence: [{ clientId: "c1", completed: 9, total: 10 }],
        lastSeen: new Map(),
        missed: new Map(),
        prs: new Set(),
      });
      const result = await repo.getClients("t1");
      expect(result).toHaveLength(1);
      expect(result[0].band).toBe("strong");
    });
  });

  // ─── Invitations ────────────────────────────────────────────────────────

  describe("listPendingInvitations", () => {
    it("returns the rows", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      const rows = [{ id: "i1", clientEmail: "a@b.io", status: "pending" }];
      (getDb as any).mockReturnValue(dbWithSelects([rows]));
      expect(await repo.listPendingInvitations("t1")).toEqual(rows);
    });
  });

  describe("cancelInvitation", () => {
    it("returns true when a row is updated", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "i1" }]),
            }),
          }),
        }),
      });
      expect(await repo.cancelInvitation("t1", "i1")).toBe(true);
    });

    it("returns false when no row matched", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });
      expect(await repo.cancelInvitation("t1", "missing")).toBe(false);
    });
  });

  describe("inviteClientByEmail", () => {
    /**
     * Build a tx mock whose `select()` returns queued results and whose
     * `insert()` returns the queued insert result. Wrapped by a db whose
     * `transaction(fn)` invokes `fn(tx)`.
     */
    function txDb(opts: { selects: unknown[][]; inserts?: unknown[][] }) {
      let si = 0;
      let ii = 0;
      const tx = {
        select: vi.fn(() => selectResult(() => opts.selects[si++] ?? [])),
        insert: vi.fn(() => ({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue(opts.inserts?.[ii++] ?? [{ id: "new-id" }]),
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        })),
      };
      return {
        db: {
          transaction: vi.fn(async (fn: any) => fn(tx)),
        },
        tx,
      };
    }

    it("rejects self-invite (400 self_invite)", async () => {
      const { TrainerRepository, InviteError } =
        await import("../trainerRepository");
      const repo = new TrainerRepository();
      const { db } = txDb({
        selects: [[{ email: "ME@X.io" }]], // trainer email matches
      });
      (getDb as any).mockReturnValue(db);
      // Self-invite throws before any slot/profile lookup; assert both the
      // structured fields and the InviteError type on the same rejection.
      const err = await repo
        .inviteClientByEmail("t1", "  me@x.io ", null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InviteError);
      expect(err).toMatchObject({ status: 400, code: "self_invite" });
    });

    it("rejects when no slots (403 no_slots) — null limit", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      // limit unknown (no live subscription) → slotsTotal null → full
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(null);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }], // trainer email (no match)
          [{ total: 0 }], // active count
        ],
      });
      (getDb as any).mockReturnValue(db);
      await expect(
        repo.inviteClientByEmail("t1", "client@x.io", null),
      ).rejects.toMatchObject({ status: 403, code: "no_slots" });
    });

    it("rejects when no slots (403) — limit reached", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(2);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 2 }], // full
        ],
      });
      (getDb as any).mockReturnValue(db);
      await expect(
        repo.inviteClientByEmail("t1", "client@x.io", null),
      ).rejects.toMatchObject({ status: 403, code: "no_slots" });
    });

    it("creates a relationship when the client profile exists", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db, tx } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 1 }],
          [{ id: "c1", fullName: "Client Name" }], // profile found
          [], // no existing relationship
        ],
        inserts: [[{ id: "rel-1" }]],
      });
      (getDb as any).mockReturnValue(db);
      const result = await repo.inviteClientByEmail(
        "t1",
        "Client@X.io",
        "Wants strength coaching",
      );
      expect(result).toEqual({
        success: true,
        action: "relationship_created",
        relationshipId: "rel-1",
        clientId: "c1",
        clientName: "Client Name",
        message: "Training request sent to Client Name",
      });
      expect(tx.insert).toHaveBeenCalledTimes(1);
    });

    it("rejects duplicate relationship (409 exists)", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 1 }],
          [{ id: "c1", fullName: "Client" }],
          // existing LIVE relationship (active) → 409, not a revive
          [{ id: "rel-existing", status: "active" }],
        ],
      });
      (getDb as any).mockReturnValue(db);
      await expect(
        repo.inviteClientByEmail("t1", "client@x.io", null),
      ).rejects.toMatchObject({ status: 409, code: "exists" });
    });

    it("revives a terminated relationship and re-stamps initiated_by='trainer' (email invite → client accepts)", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const setSpy = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      let si = 0;
      const selects = [
        [{ email: "trainer@x.io" }],
        [{ total: 1 }],
        [{ id: "c1", fullName: "Client" }],
        // dormant row from a PRIOR invite-code redeem (initiated_by would be
        // 'client'); the revive must flip it back to 'trainer'.
        [{ id: "rel-existing", status: "terminated" }],
      ];
      const tx = {
        select: vi.fn(() => selectResult(() => selects[si++] ?? [])),
        update: vi.fn(() => ({ set: setSpy })),
      };
      (getDb as any).mockReturnValue({
        transaction: vi.fn(async (fn: any) => fn(tx)),
      });
      const result = await repo.inviteClientByEmail("t1", "client@x.io", null);
      expect(result).toMatchObject({
        action: "relationship_created",
        relationshipId: "rel-existing",
      });
      expect(setSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending", initiatedBy: "trainer" }),
      );
    });

    it("creates an invitation when no profile exists", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 1 }],
          [], // no profile
          [], // no existing invitation
        ],
        inserts: [[{ id: "inv-1" }]],
      });
      (getDb as any).mockReturnValue(db);
      const result = await repo.inviteClientByEmail("t1", "New@X.io", null);
      expect(result).toEqual({
        success: true,
        action: "invitation_created",
        invitationId: "inv-1",
        clientEmail: "new@x.io",
        message: "Invitation will be sent when new@x.io signs up",
      });
    });

    it("uses email fallback in relationship message when name is null", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 0 }],
          [{ id: "c2", fullName: null }],
          [],
        ],
        inserts: [[{ id: "rel-2" }]],
      });
      (getDb as any).mockReturnValue(db);
      const result = await repo.inviteClientByEmail("t1", "noname@x.io", null);
      expect(result.clientName).toBeNull();
      expect(result.message).toBe("Training request sent to noname@x.io");
    });

    it("rejects duplicate pending invitation (409 exists)", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 0 }],
          [], // no profile
          [{ id: "inv-existing" }], // existing invitation
        ],
      });
      (getDb as any).mockReturnValue(db);
      await expect(
        repo.inviteClientByEmail("t1", "dup@x.io", null),
      ).rejects.toMatchObject({ status: 409, code: "exists" });
    });

    it("does not treat a missing trainer email as a self-invite", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db } = txDb({
        selects: [
          [{ email: null }], // no trainer email on record
          [{ total: 0 }],
          [], // no profile
          [], // no existing invitation
        ],
        inserts: [[{ id: "inv-3" }]],
      });
      (getDb as any).mockReturnValue(db);
      const result = await repo.inviteClientByEmail("t1", "x@y.io", null);
      expect(result.action).toBe("invitation_created");
    });

    it("revives a terminated relationship instead of crashing on the unique index", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const repo = new TrainerRepository();
      vi.spyOn(repo, "getTrainerClientLimit").mockResolvedValue(10);
      const { db, tx } = txDb({
        selects: [
          [{ email: "trainer@x.io" }],
          [{ total: 1 }],
          [{ id: "c9", fullName: "Returning Client" }], // profile found
          // dormant relationship for this pair — must be revived in place,
          // NOT re-inserted (the unique index forbids a second row).
          [{ id: "rel-old", status: "terminated" }],
        ],
      });
      (getDb as any).mockReturnValue(db);
      const result = await repo.inviteClientByEmail(
        "t1",
        "returning@x.io",
        "Back for another block",
      );
      expect(result).toEqual({
        success: true,
        action: "relationship_created",
        relationshipId: "rel-old",
        clientId: "c9",
        clientName: "Returning Client",
        message: "Training request sent to Returning Client",
      });
      // Revived via UPDATE, not a duplicate INSERT.
      expect(tx.update).toHaveBeenCalledTimes(1);
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  // ─── Programmes (specs/19-programs) ─────────────────────────────────────

  describe("formatProgramLabel", () => {
    it("finite: name · Wk N / M with calendar-derived week", async () => {
      const { formatProgramLabel } = await import("../trainerRepository");
      expect(
        formatProgramLabel(
          {
            programName: "Strength",
            startDate: "2026-06-26",
            endDate: "2026-09-17",
            durationWeeks: 12,
          },
          "2026-07-03", // 7 elapsed days → week 2
        ),
      ).toBe("Strength · Wk 2 / 12");
    });

    it("indefinite: name · Wk N with no denominator", async () => {
      const { formatProgramLabel } = await import("../trainerRepository");
      expect(
        formatProgramLabel(
          {
            programName: "Cut",
            startDate: "2026-06-05",
            endDate: null,
            durationWeeks: null,
          },
          "2026-07-03", // 28 elapsed days → week 5
        ),
      ).toBe("Cut · Wk 5");
    });
  });

  describe("getLiveProgramInfoByClient", () => {
    it("returns an empty map without querying for an empty client list", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const db = dbWithSelects([]);
      (getDb as any).mockReturnValue(db);
      const repo = new TrainerRepository();
      const out = await repo.getLiveProgramInfoByClient("t-1", []);
      expect(out.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it("maps one live programme per client; latest-started wins on overlap", async () => {
      const { TrainerRepository } = await import("../trainerRepository");
      const db = dbWithSelects([
        [
          {
            clientId: "c-1",
            programName: "Old Block",
            startDate: "2026-05-01",
            endDate: "2026-07-24",
            durationWeeks: 12,
          },
          {
            clientId: "c-1",
            programName: "New Block",
            startDate: "2026-06-26",
            endDate: null,
            durationWeeks: null,
          },
          {
            clientId: "c-2",
            programName: "Mobility",
            startDate: "2026-07-01",
            endDate: "2026-08-11",
            durationWeeks: 6,
          },
        ],
      ]);
      (getDb as any).mockReturnValue(db);
      const repo = new TrainerRepository();
      const out = await repo.getLiveProgramInfoByClient("t-1", ["c-1", "c-2"]);
      // Rows arrive start-date ascending; the Map overwrite keeps the
      // latest-started programme for c-1.
      expect(out.get("c-1")).toMatchObject({
        programName: "New Block",
        durationWeeks: null,
      });
      expect(out.get("c-2")).toMatchObject({
        programName: "Mobility",
        endDate: "2026-08-11",
      });
    });
  });
});
