/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PER-112: the `programme` set-up section's edge cases that the end-to-end
 * suite (designG.sequence.integration.test.ts) doesn't reach: an item with no
 * refId on accept, a programme that can't be assigned any more, a null
 * sessions target, and previews of missing programmes. The database is a
 * stub returning fixed rows; the SQL itself is proven in the PGlite suite.
 */

const assign = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("../assignProgrammeInSequence", () => ({
  assignProgrammeInSequence: vi.fn(async () => assign.result),
}));

import { programmeSetupHandler } from "../programmeSetupHandler";
import { assignProgrammeInSequence } from "../assignProgrammeInSequence";
import { loadSequenceProgress } from "../sequenceProgress";

function stubDb(rows: unknown[]) {
  const builder: any = {};
  for (const m of ["from", "where", "limit", "innerJoin", "orderBy"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown[]) => unknown) => resolve(rows);
  return { select: vi.fn(() => builder) } as any;
}

const item = (refId: string | null, config: Record<string, unknown> = {}) =>
  ({
    id: "item-1",
    profileId: "profile-1",
    section: "programme",
    refId,
    config,
    sortOrder: 0,
  }) as any;

const ctx = {
  tx: {} as any,
  trainerId: "coach-1",
  clientId: "athlete-1",
  relationshipId: "rel-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("programmeSetupHandler", () => {
  it("keeps no sessions target when it's null", async () => {
    const verdict = await programmeSetupHandler.validate(
      stubDb([{ id: "prog-1", workouts: 3 }]),
      "coach-1",
      { refId: "prog-1", config: { sessionsPerWeek: null }, sortOrder: 2 },
    );
    expect(verdict).toEqual({
      ok: true,
      item: { refId: "prog-1", config: {}, sortOrder: 2 },
    });
  });

  it("materialises nothing for an item with no refId", async () => {
    expect(await programmeSetupHandler.materialise(ctx, item(null))).toEqual({
      refId: null,
    });
    expect(assignProgrammeInSequence).not.toHaveBeenCalled();
  });

  it("materialises nothing when the programme can't be assigned any more", async () => {
    assign.result = { error: "empty_program" };
    expect(
      await programmeSetupHandler.materialise(ctx, item("prog-1")),
    ).toEqual({ refId: null });
    expect(assignProgrammeInSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        assignerId: "coach-1",
        clientId: "athlete-1",
        programId: "prog-1",
        tx: ctx.tx,
      }),
    );
  });

  it("records the new assignment's id on success", async () => {
    assign.result = { assignment: { id: "pa-9" } };
    expect(
      await programmeSetupHandler.materialise(ctx, item("prog-1")),
    ).toEqual({ refId: "pa-9" });
  });

  it("previews nothing without refIds, and skips programmes that are gone", async () => {
    const db = stubDb([{ id: "prog-1", name: "Base", workouts: 0 }]);
    expect(await programmeSetupHandler.preview!(db, [item(null)])).toEqual({
      programmes: [],
    });
    expect(
      await programmeSetupHandler.preview!(db, [
        item("prog-1"),
        item("prog-gone"),
      ]),
    ).toEqual({ programmes: [{ name: "Base", workouts: 0 }] });
  });
});

describe("loadSequenceProgress", () => {
  it("reads nothing for no assignments", async () => {
    const db = stubDb([]);
    expect(await loadSequenceProgress(db, [])).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });
});
