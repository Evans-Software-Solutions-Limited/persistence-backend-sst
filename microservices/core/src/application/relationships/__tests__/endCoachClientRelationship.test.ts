/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

// auditTrainerAction is mocked so this test can assert the exact audit
// payload (25-coach-client-offboarding § 1 step 5) without re-deriving the
// insert path — mirrors trainersRespondToClientRequestHandler.test.ts.
const auditTrainerAction = vi.fn(async () => {});
vi.mock("../auditTrainerAction", () => ({
  auditTrainerAction: (...args: unknown[]) =>
    auditTrainerAction(...(args as [])),
}));

// 26-coach-data-sharing-consent: recordDataSharingConsent is unit-tested on
// its own (recordDataSharingConsent.test.ts) — mocked here so the teardown-tx
// queue assertions stay focused on the relationship/assignment writes.
const recordConsent = vi.fn(async () => {});
vi.mock("../recordDataSharingConsent", () => ({
  recordDataSharingConsent: (...args: unknown[]) =>
    recordConsent(...(args as [])),
}));

/**
 * Thenable query-builder mock (one queue entry == one awaited query),
 * extended from trainersRespondToClientRequestHandler.test.ts's `executor`
 * with `delete`/`insert`/`values` and a `.where()` condition capture so the
 * delete queries' scoping columns can be rendered via `PgDialect` — the
 * mocked-DB SQL blind spot per reference_drizzle_groupby_param_bug.md.
 */
interface Capture {
  wheres: unknown[];
}
function executor(queue: unknown[], capture: Capture) {
  let i = 0;
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of [
    "select",
    "from",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "update",
    "delete",
    "insert",
    "values",
    "set",
    "returning",
    "for",
  ]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.where = vi.fn((cond: unknown) => {
    capture.wheres.push(cond);
    return builder;
  });
  builder.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const next = queue[i++] ?? [];
    if (next instanceof Error) return reject(next);
    return resolve(next as unknown[]);
  };
  return builder;
}

/** db mock whose `.transaction(fn)` runs `fn` against the SAME queued executor. */
function txDb(queue: unknown[], capture: Capture = { wheres: [] }) {
  const ex = executor(queue, capture);
  (ex as any).transaction = vi.fn(async (fn: any) => fn(ex));
  return { ex, capture };
}

describe("endCoachClientRelationship", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path (initiatedBy 'trainer'): soft-ends, deletes both assignment kinds, audits once, returns counts", async () => {
    const { ex, capture } = txDb([
      // 0. pre-update SELECT of the stamped consent_version — deliberately a
      // value != CONSENT_VERSION to prove the withdraw row records the version
      // the client actually granted, not the current constant.
      [{ consentVersion: "v0-legacy" }],
      [{ id: "rel-1" }], // 1. soft-end UPDATE .returning()
      [{ id: "pa-1" }], // 2. delete programAssignments .returning() (1 row)
      [{ id: "wa-1" }, { id: "wa-2" }], // 3. delete workoutAssignments .returning() (2 rows)
    ]);
    (getDb as any).mockReturnValue(ex);

    const { endCoachClientRelationship } =
      await import("../endCoachClientRelationship");
    const result = await endCoachClientRelationship({
      trainerId: "trainer-1",
      clientId: "client-1",
      initiatedBy: "trainer",
    });

    expect(result).toEqual({
      ok: true,
      relationshipId: "rel-1",
      programmesRemoved: 1,
      workoutAssignmentsRemoved: 2,
    });

    expect(auditTrainerAction).toHaveBeenCalledTimes(1);
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        actionType: "relationship_terminated",
        targetTable: "pt_client_relationships",
        targetRowId: "rel-1",
        payload: expect.objectContaining({
          initiatedBy: "trainer",
          programmesRemoved: 1,
          workoutAssignmentsRemoved: 2,
        }),
      }),
    );

    // Guard shape: the soft-end SET carries the terminal status + a today
    // end-date marker + a fresh updatedAt.
    expect(ex.set).toHaveBeenCalledTimes(1);
    const setArgs = ex.set.mock.calls[0][0];
    expect(setArgs.status).toBe("terminated");
    expect(setArgs.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(setArgs.updatedAt).toBeInstanceOf(Date);
    expect(ex.where).toHaveBeenCalledTimes(4); // consent-version select + update + 2 deletes

    // 26-coach-data-sharing-consent: withdrawal clears the current-consent
    // stamp on the SAME update, and appends a `withdraw` row — source
    // `coach_removed` for a trainer-initiated end.
    expect(setArgs.consentGivenAt).toBeNull();
    expect(setArgs.consentVersion).toBeNull();
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        action: "withdraw",
        source: "coach_removed",
        // The version the client granted under (read pre-update), NOT the
        // current CONSENT_VERSION constant.
        consentVersion: "v0-legacy",
      }),
    );

    // PgDialect render guard: prove the two DELETEs are scoped by the right
    // columns, not merely "some where clause ran" — a mocked builder would
    // pass this test even with clientId/trainerId swapped or dropped.
    const dialect = new PgDialect();
    // wheres order: [0] consent-version select, [1] soft-end update,
    // [2] programmes delete, [3] workout-assignments delete.
    const [, , programmesWhere, assignmentsWhere] = capture.wheres.map(
      (c) => dialect.sqlToQuery(c as never).sql,
    );
    expect(programmesWhere).toContain('"client_id"');
    expect(programmesWhere).toContain('"assigned_by"');
    expect(assignmentsWhere).toContain('"client_id"');
    expect(assignmentsWhere).toContain('"trainer_id"');
  });

  it("happy path (initiatedBy 'client'): audit payload records the client direction", async () => {
    const { ex } = txDb([
      [{ consentVersion: "v1-2026-07" }], // 0. pre-update consent-version SELECT
      [{ id: "rel-2" }],
      [],
      [],
    ]);
    (getDb as any).mockReturnValue(ex);

    const { endCoachClientRelationship } =
      await import("../endCoachClientRelationship");
    const result = await endCoachClientRelationship({
      trainerId: "trainer-1",
      clientId: "client-1",
      initiatedBy: "client",
    });

    expect(result).toEqual({
      ok: true,
      relationshipId: "rel-2",
      programmesRemoved: 0,
      workoutAssignmentsRemoved: 0,
    });
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ initiatedBy: "client" }),
      }),
    );
    // 26-coach-data-sharing-consent: client-initiated end (Leave Coach) records
    // source `leave_coach`, distinct from the trainer-initiated case above.
    expect(recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        action: "withdraw",
        source: "leave_coach",
      }),
    );
  });

  it("404 when the soft-end UPDATE matches no row (not-active / not-yours / AI-trainer) — no deletes, no audit", async () => {
    // 0. pre-update consent-version SELECT (no active row → []), then the
    // soft-end UPDATE .returning() → 0 rows.
    const { ex } = txDb([[], []]);
    (getDb as any).mockReturnValue(ex);

    const { endCoachClientRelationship } =
      await import("../endCoachClientRelationship");
    const result = await endCoachClientRelationship({
      trainerId: "trainer-1",
      clientId: "client-1",
      initiatedBy: "trainer",
    });

    expect(result).toEqual({ ok: false, status: 404 });
    expect(ex.delete).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
    expect(recordConsent).not.toHaveBeenCalled();
  });
});
