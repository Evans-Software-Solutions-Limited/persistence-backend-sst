/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { SavedGymRepository } from "../savedGymRepository";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

const gymRow = {
  id: "gym-1",
  name: "Hotel gym",
  equipmentTypeIds: ["eq-1", "eq-2"],
  createdAt: new Date("2026-07-26T10:00:00Z"),
  updatedAt: new Date("2026-07-26T10:00:00Z"),
};

/** `select().from().where().orderBy()` — the list shape. */
function makeListChain(rows: any, capture: { where?: unknown } = {}) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.orderBy = vi.fn().mockResolvedValue(rows);
  return chain;
}

/** `select().from().where().limit()` — the single-row shape. */
function makeGetChain(rows: any, capture: { where?: unknown } = {}) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.limit = vi.fn().mockResolvedValue(rows);
  return chain;
}

/** `select().from().where()` — the equipment-validation shape (no limit). */
function makeEquipmentChain(rows: any) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(rows);
  return chain;
}

function makeInsertChain(
  result: any,
  capture: { values?: unknown } = {},
): { insert: any } {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn((v: unknown) => {
        capture.values = v;
        return {
          returning: vi
            .fn()
            .mockImplementation(() =>
              result instanceof Error
                ? Promise.reject(result)
                : Promise.resolve(result),
            ),
        };
      }),
    }),
  };
}

function makeUpdateChain(
  result: any,
  capture: { where?: unknown; set?: unknown } = {},
) {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn((s: unknown) => {
        capture.set = s;
        return {
          where: vi.fn((w: unknown) => {
            capture.where = w;
            return {
              returning: vi
                .fn()
                .mockImplementation(() =>
                  result instanceof Error
                    ? Promise.reject(result)
                    : Promise.resolve(result),
                ),
            };
          }),
        };
      }),
    }),
  };
}

function makeDeleteChain(rows: any, capture: { where?: unknown } = {}) {
  return {
    delete: vi.fn().mockReturnValue({
      where: vi.fn((w: unknown) => {
        capture.where = w;
        return { returning: vi.fn().mockResolvedValue(rows) };
      }),
    }),
  };
}

/** A postgres.js unique_violation on the per-user gym-name index. */
function uniqueViolation(constraint = "saved_gyms_user_name_key") {
  return Object.assign(new Error("duplicate key value"), {
    code: "23505",
    constraint_name: constraint,
  });
}

describe("SavedGymRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Rendered SQL (the mocked-getDb blind spot) ──────────────────────
  //
  // getDb is mocked, so a query that forgot its ownership filter would ship
  // green. Every read and write path renders its WHERE and asserts user_id is
  // in it (memory/reference_drizzle_groupby_param_bug).
  describe("rendered ownership predicates", () => {
    it("list scopes to user_id", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeListChain([], capture)),
      });

      await new SavedGymRepository().list("user-1");

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"user_id"');
    });

    it("getById scopes to BOTH id and user_id", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeGetChain([], capture)),
      });

      await new SavedGymRepository().getById("gym-1", "user-1");

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"id"');
      expect(rendered).toContain('"user_id"');
    });

    // Ownership is folded into the mutating statement's WHERE rather than
    // checked by a preceding SELECT — no TOCTOU window
    // (workoutRepository.ts:398-401).
    it("update folds ownership into the UPDATE's WHERE", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue(makeUpdateChain([gymRow], capture));

      await new SavedGymRepository().update("gym-1", "user-1", {
        name: "Renamed",
      });

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"id"');
      expect(rendered).toContain('"user_id"');
    });

    it("delete folds ownership into the DELETE's WHERE", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue(
        makeDeleteChain([{ id: "gym-1" }], capture),
      );

      await new SavedGymRepository().delete("gym-1", "user-1");

      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"id"');
      expect(rendered).toContain('"user_id"');
    });
  });

  // ─── Two-user isolation (CLAUDE.md § Dangerous Areas) ────────────────
  //
  // The predicates above are what MAKE these pass; these prove the observable
  // behaviour a client would see. requirements.md § Data-isolation acceptance.
  describe("two-user isolation", () => {
    it("user B reading user A's gym gets null (→ 404), not the row", async () => {
      // Ownership is in the WHERE, so the query returns zero rows for B.
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeGetChain([])),
      });

      const result = await new SavedGymRepository().getById("gym-1", "user-b");
      expect(result).toBeNull();
    });

    it("user B updating user A's gym gets not_found, and writes nothing", async () => {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue(makeUpdateChain([], capture));

      const result = await new SavedGymRepository().update("gym-1", "user-b", {
        name: "Hijacked",
      });

      expect(result).toEqual({ status: "not_found" });
      // The UPDATE ran but matched zero rows — A's gym is untouched because
      // user_id is part of the predicate, not a post-hoc check.
      const rendered = new PgDialect().sqlToQuery(capture.where as never).sql;
      expect(rendered).toContain('"user_id"');
    });

    it("user B deleting user A's gym gets false (→ 404)", async () => {
      (getDb as any).mockReturnValue(makeDeleteChain([]));

      expect(await new SavedGymRepository().delete("gym-1", "user-b")).toBe(
        false,
      );
    });

    it("a concurrent double-delete is a 404, not a 500", async () => {
      (getDb as any).mockReturnValue(makeDeleteChain([]));
      expect(await new SavedGymRepository().delete("gym-1", "user-1")).toBe(
        false,
      );
    });
  });

  describe("list", () => {
    it("returns the caller's rows", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeListChain([gymRow])),
      });

      const result = await new SavedGymRepository().list("user-1");
      expect(result).toEqual([gymRow]);
    });
  });

  describe("create", () => {
    it("trims the name and dedupes the kit before insert", async () => {
      const capture: { values?: any } = {};
      (getDb as any).mockReturnValue({
        // findUnknownEquipmentTypeIds — both ids known.
        select: vi
          .fn()
          .mockReturnValue(
            makeEquipmentChain([{ id: "eq-1" }, { id: "eq-2" }]),
          ),
        ...makeInsertChain([gymRow], capture),
      });

      const result = await new SavedGymRepository().create("user-1", {
        name: "  Hotel gym  ",
        // The picker can hand the same chip back twice.
        equipmentTypeIds: ["eq-1", "eq-2", "eq-1"],
      });

      expect(result).toEqual({ status: "ok", gym: gymRow });
      expect(capture.values).toEqual({
        userId: "user-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-1", "eq-2"],
      });
    });

    it("rejects unknown equipment ids with the offending ids named (400)", async () => {
      (getDb as any).mockReturnValue({
        // Only eq-1 exists in equipment_types.
        select: vi.fn().mockReturnValue(makeEquipmentChain([{ id: "eq-1" }])),
        insert: vi.fn(),
      });

      const repo = new SavedGymRepository();
      const result = await repo.create("user-1", {
        name: "Garage",
        equipmentTypeIds: ["eq-1", "eq-missing"],
      });

      expect(result).toEqual({
        status: "unknown_equipment",
        unknownEquipmentTypeIds: ["eq-missing"],
      });
    });

    it("does not INSERT at all when the kit is invalid", async () => {
      const insert = vi.fn();
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        insert,
      });

      await new SavedGymRepository().create("user-1", {
        name: "Garage",
        equipmentTypeIds: ["eq-missing"],
      });

      expect(insert).not.toHaveBeenCalled();
    });

    // The uniqueness index is an EXPRESSION index (lower(btrim(name))), which
    // drizzle's onConflictDoNothing can't infer a target for — so the duplicate
    // is caught from the violation. That is also the race-free option: a
    // pre-flight SELECT has a window between read and insert.
    it("maps a unique violation on the name index to duplicate_name (409)", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        ...makeInsertChain(uniqueViolation()),
      });

      const result = await new SavedGymRepository().create("user-1", {
        name: "Hotel gym",
        equipmentTypeIds: [],
      });

      expect(result).toEqual({ status: "duplicate_name" });
    });

    it("rethrows a unique violation from an UNRELATED constraint", async () => {
      // A future unique index on this table must not be misreported to the user
      // as "that name is taken".
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        ...makeInsertChain(uniqueViolation("saved_gyms_some_other_key")),
      });

      await expect(
        new SavedGymRepository().create("user-1", {
          name: "Hotel gym",
          equipmentTypeIds: [],
        }),
      ).rejects.toThrow("duplicate key value");
    });

    // postgres.js populates `constraint_name`; a driver upgrade that stopped
    // doing so must not turn a genuine duplicate into an opaque 500 — this table
    // has exactly one unique index, so a unique violation on it can only be the
    // name conflict.
    it("treats a unique violation with no constraint_name as duplicate_name", async () => {
      const bare = Object.assign(new Error("duplicate key value"), {
        code: "23505",
      });
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        ...makeInsertChain(bare),
      });

      expect(
        await new SavedGymRepository().create("user-1", {
          name: "Hotel gym",
          equipmentTypeIds: [],
        }),
      ).toEqual({ status: "duplicate_name" });
    });

    it("rethrows a non-object throw (a bare string) untouched", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        // Not via makeInsertChain: that helper only rejects on an Error
        // instance, and the point here is the non-Error branch of the guard.
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue("kaboom"),
          }),
        }),
      });

      await expect(
        new SavedGymRepository().create("user-1", {
          name: "Hotel gym",
          equipmentTypeIds: [],
        }),
      ).rejects.toBe("kaboom");
    });

    it("rethrows a non-unique-violation database error", async () => {
      const boom = Object.assign(new Error("connection reset"), {
        code: "08006",
      });
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        ...makeInsertChain(boom),
      });

      await expect(
        new SavedGymRepository().create("user-1", {
          name: "Hotel gym",
          equipmentTypeIds: [],
        }),
      ).rejects.toThrow("connection reset");
    });

    it("allows an empty kit — a half-finished setup is savable", async () => {
      const capture: { values?: any } = {};
      const select = vi.fn();
      (getDb as any).mockReturnValue({
        select,
        ...makeInsertChain([{ ...gymRow, equipmentTypeIds: [] }], capture),
      });

      const result = await new SavedGymRepository().create("user-1", {
        name: "Empty",
        equipmentTypeIds: [],
      });

      expect(result.status).toBe("ok");
      // Short-circuits: an empty kit needs no validation round trip.
      expect(select).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("is present-only — an omitted field is left untouched", async () => {
      const capture: { set?: any } = {};
      (getDb as any).mockReturnValue(makeUpdateChain([gymRow], capture));

      await new SavedGymRepository().update("gym-1", "user-1", {
        name: "Renamed",
      });

      expect(capture.set).toHaveProperty("name", "Renamed");
      expect(capture.set).not.toHaveProperty("equipmentTypeIds");
      // updated_at always moves on a successful write.
      expect(capture.set.updatedAt).toBeInstanceOf(Date);
    });

    it("validates a replacement kit before writing anything", async () => {
      const update = vi.fn();
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
        update,
      });

      const result = await new SavedGymRepository().update("gym-1", "user-1", {
        equipmentTypeIds: ["eq-missing"],
      });

      expect(result).toEqual({
        status: "unknown_equipment",
        unknownEquipmentTypeIds: ["eq-missing"],
      });
      expect(update).not.toHaveBeenCalled();
    });

    it("trims and dedupes on update too", async () => {
      const capture: { set?: any } = {};
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([{ id: "eq-1" }])),
        ...makeUpdateChain([gymRow], capture),
      });

      await new SavedGymRepository().update("gym-1", "user-1", {
        name: "  Garage  ",
        equipmentTypeIds: ["eq-1", "eq-1"],
      });

      expect(capture.set.name).toBe("Garage");
      expect(capture.set.equipmentTypeIds).toEqual(["eq-1"]);
    });

    it("maps a rename onto an existing name to duplicate_name (409)", async () => {
      (getDb as any).mockReturnValue(makeUpdateChain(uniqueViolation()));

      const result = await new SavedGymRepository().update("gym-1", "user-1", {
        name: "Hotel gym",
      });

      expect(result).toEqual({ status: "duplicate_name" });
    });

    it("returns the updated row on success", async () => {
      (getDb as any).mockReturnValue(makeUpdateChain([gymRow]));

      const result = await new SavedGymRepository().update("gym-1", "user-1", {
        name: "Hotel gym",
      });

      expect(result).toEqual({ status: "ok", gym: gymRow });
    });
  });

  describe("delete", () => {
    it("returns true when a row was removed", async () => {
      (getDb as any).mockReturnValue(makeDeleteChain([{ id: "gym-1" }]));
      expect(await new SavedGymRepository().delete("gym-1", "user-1")).toBe(
        true,
      );
    });
  });

  describe("findUnknownEquipmentTypeIds", () => {
    it("returns [] for an empty input without querying", async () => {
      const select = vi.fn();
      (getDb as any).mockReturnValue({ select });

      expect(
        await new SavedGymRepository().findUnknownEquipmentTypeIds([]),
      ).toEqual([]);
      expect(select).not.toHaveBeenCalled();
    });

    it("returns [] when every id is known", async () => {
      (getDb as any).mockReturnValue({
        select: vi
          .fn()
          .mockReturnValue(
            makeEquipmentChain([{ id: "eq-1" }, { id: "eq-2" }]),
          ),
      });

      expect(
        await new SavedGymRepository().findUnknownEquipmentTypeIds([
          "eq-1",
          "eq-2",
        ]),
      ).toEqual([]);
    });

    it("dedupes before querying, and reports each unknown id once", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeEquipmentChain([])),
      });

      expect(
        await new SavedGymRepository().findUnknownEquipmentTypeIds([
          "eq-x",
          "eq-x",
          "eq-y",
        ]),
      ).toEqual(["eq-x", "eq-y"]);
    });
  });
});
