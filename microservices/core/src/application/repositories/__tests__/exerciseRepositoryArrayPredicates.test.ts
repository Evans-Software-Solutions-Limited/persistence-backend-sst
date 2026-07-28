/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { ExerciseRepository } from "../exerciseRepository";

/**
 * Every array-valued predicate in `ExerciseRepository`, asserted to render as an
 * `ARRAY[…]::uuid[]` literal Postgres can actually execute.
 *
 * ## Why this file exists
 *
 * `sql`${jsArray}::uuid[]`` looks correct and is not. Drizzle renders a bare
 * array as a PARENTHESISED placeholder list — the shape `IN (…)` needs — so the
 * cast lands on a row constructor and the query dies at execution time:
 *
 *   - 2+ ids → `ERROR: cannot cast type record to uuid[]`
 *   - 1 id   → `ERROR: malformed array literal`
 *
 * Both surfaced only on a real device against staging, as a 500 behind Loadout's
 * "Couldn't adapt this workout". Two of the four call sites had carried the bug
 * since 2026-04-20 without anyone noticing, because the mobile exercise library
 * filters locally from its SQLite cache and never sends `targeted_muscles_any`
 * or `equipment_any` to the server — Loadout's preview was the first caller to
 * execute them.
 *
 * ## Why the existing render test did not catch it
 *
 * It did render the SQL. Its assertion just pinned the WRONG shape
 * (`/\(\$\d+\)::uuid\[\]/`), freezing the bug in as the expectation. Rendering
 * closes the mocked-`getDb` blind spot only for defects the author already knows
 * to look for; it cannot tell you the SQL is executable. So the arity sweep below
 * is paired with a blanket ban on the paren-cast form — that one is mechanical,
 * and does not depend on anybody remembering which operand order is right.
 *
 * ⚠ Both arities are exercised on purpose. A one-element array renders `($1)`,
 * which is not a record at all — it is a scalar in parentheses — so it fails with
 * a DIFFERENT error and would survive a test that only ever passed two ids.
 */

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";

const CHEST = "11111111-1111-4111-8111-111111111111";
const BACK = "33333333-3333-4333-8333-333333333333";
const DUMBBELL = "22222222-2222-4222-8222-222222222222";
const BARBELL = "44444444-4444-4444-8444-444444444444";
const SQUAT = "55555555-5555-4555-8555-555555555555";
const BENCH = "66666666-6666-4666-8666-666666666666";

/**
 * Any `(…)::uuid[]` — the row-constructor cast that Postgres rejects. Written to
 * match one OR many placeholders so neither arity can slip through.
 */
const PAREN_CAST = /\(\$\d+(,\s*\$\d+)*\)::uuid\[\]/;

function render(where: unknown): string {
  return new PgDialect().sqlToQuery(where as never).sql;
}

describe("array-valued predicates render as executable ARRAY[…] literals", () => {
  let capture: { where?: unknown };

  beforeEach(() => {
    capture = {};
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn((w: unknown) => {
      capture.where = w;
      return chain;
    });
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.offset = vi.fn().mockResolvedValue([]);
    chain.limit = vi.fn().mockReturnValue(chain);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
  });

  /** `list()` resolves through `.limit().offset()`; the candidate query awaits `.limit()`. */
  function candidateChain() {
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn((w: unknown) => {
      capture.where = w;
      return chain;
    });
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue([]);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
  }

  describe.each([
    { arity: "one id", muscles: [CHEST], kit: [DUMBBELL], exclude: [SQUAT] },
    {
      arity: "several ids",
      muscles: [CHEST, BACK],
      kit: [DUMBBELL, BARBELL],
      exclude: [SQUAT, BENCH],
    },
  ])("with $arity", ({ muscles, kit, exclude }) => {
    it("renders targeted-muscle overlap as ARRAY[…]::uuid[]", async () => {
      await new ExerciseRepository().list(
        { targetedMusclesAny: muscles },
        "user-a",
      );

      const sql = render(capture.where);
      expect(sql).toMatch(
        new RegExp(
          `"exercises"\\."primary_muscles" && ARRAY\\[\\$\\d+(, \\$\\d+)*\\]::uuid\\[\\]`,
        ),
      );
      expect(sql).not.toMatch(PAREN_CAST);
    });

    it("renders equipment overlap as ARRAY[…]::uuid[]", async () => {
      await new ExerciseRepository().list({ equipmentAny: kit }, "user-a");

      const sql = render(capture.where);
      expect(sql).toMatch(
        new RegExp(
          `"exercises"\\."equipment_required" && ARRAY\\[\\$\\d+(, \\$\\d+)*\\]::uuid\\[\\]`,
        ),
      );
      expect(sql).not.toMatch(PAREN_CAST);
    });

    it("renders Loadout containment as ARRAY[…]::uuid[]", async () => {
      candidateChain();
      await new ExerciseRepository().listAdaptationCandidates("user-a", {
        muscleIds: muscles,
        equipmentTypeIds: kit,
      });

      const sql = render(capture.where);
      expect(sql).toMatch(/ARRAY\[\$\d+(, \$\d+)*\]::uuid\[\] @> COALESCE/);
      expect(sql).not.toMatch(PAREN_CAST);
    });

    it("renders the exclusion list as ARRAY[…]::uuid[]", async () => {
      candidateChain();
      await new ExerciseRepository().listAdaptationCandidates("user-a", {
        muscleIds: muscles,
        equipmentTypeIds: kit,
        excludeExerciseIds: exclude,
      });

      const sql = render(capture.where);
      expect(sql).toMatch(
        /"exercises"\."id" <> ALL\(ARRAY\[\$\d+(, \$\d+)*\]::uuid\[\]\)/,
      );
      expect(sql).not.toMatch(PAREN_CAST);
    });
  });

  it("binds one placeholder per id, and the ids themselves", async () => {
    // The point of `ARRAY[…]` over a string-built literal: the values still go
    // over the wire as parameters. A helper that interpolated them into the SQL
    // text would satisfy every shape assertion above and be an injection hole.
    candidateChain();
    await new ExerciseRepository().listAdaptationCandidates("user-a", {
      muscleIds: [CHEST, BACK],
      equipmentTypeIds: [DUMBBELL],
    });

    const { sql, params } = new PgDialect().sqlToQuery(capture.where as never);
    expect(sql).not.toContain(CHEST);
    expect(params).toEqual(expect.arrayContaining([CHEST, BACK, DUMBBELL]));
  });

  it("keeps the single-muscle `muscleGroup` alias a scalar uuid, not an array", async () => {
    // `= ANY(column)` takes a SCALAR on the left. Pushing this one through
    // `uuidArray` too — the obvious "make them all consistent" edit — would
    // compare a uuid[] against the elements of a uuid[] and fail to type-check
    // in Postgres. It is deliberately the odd one out.
    await new ExerciseRepository().list({ muscleGroup: CHEST }, "user-a");

    const sql = render(capture.where);
    expect(sql).toMatch(/\$\d+::uuid = ANY\("exercises"\."primary_muscles"\)/);
    expect(sql).not.toContain("ARRAY[");
  });
});
