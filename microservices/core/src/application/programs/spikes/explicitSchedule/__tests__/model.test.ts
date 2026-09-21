import { describe, expect, it } from "vitest";
import { buildOccurrences } from "../../../scheduling";
import {
  delivery,
  materialize,
  publish,
  reconcile,
  resolveLoad,
  startCached,
} from "../model";
import { sixWeekPlan } from "./fixtures";

const occurrences = () =>
  materialize(sixWeekPlan(), "assignment-1", "2026-09-21");

describe("W1 explicit schedule fidelity (isolated model spike)", () => {
  it("round trips six weeks without flattening weekdays, irregular weeks, deload or set variations", () => {
    const plan = sixWeekPlan();
    const restored = JSON.parse(JSON.stringify(plan));
    expect(restored).toEqual(plan);
    const rows = materialize(restored, "assignment-1", "2026-09-21");
    expect(rows.map((row) => row.dueDate)).toEqual([
      "2026-09-21",
      "2026-09-23",
      "2026-09-25",
      "2026-09-28",
      "2026-09-30",
      "2026-10-02",
      "2026-10-05",
      "2026-10-09",
      "2026-10-12",
      "2026-10-14",
      "2026-10-16",
      "2026-10-19",
      "2026-10-21",
      "2026-10-23",
      "2026-10-26",
      "2026-10-28",
      "2026-10-30",
      "2026-10-30",
    ]);
    expect(rows[8].prescription.exercises[0].sets[0]).toMatchObject({
      reps: 5,
      load: { kind: "percent_1rm", percent: 50 },
    });
    expect(rows[3].prescription.exercises[0].sets[0].load).toEqual({
      kind: "percent_1rm",
      percent: 72,
    });
    expect(rows[1].prescription.exercises[0].sets[0].load).toEqual({
      kind: "absolute",
      value: 60,
      unit: "lb",
    });
    expect(rows[0].prescription).toEqual(plan.entries[0].prescription);
    expect(rows[16].entryId).not.toBe(rows[17].entryId);
    expect(materialize(plan, "assignment-1", "2026-09-21")).toEqual(rows);
    plan.entries[0].prescription.exercises[0].sets[0].reps = 99;
    expect(rows[0].prescription.exercises[0].sets[0].reps).toBe(8);
  });

  it("uses calendar dates across DST and leap day", () => {
    const plan = sixWeekPlan();
    expect(materialize(plan, "a", "2028-02-28")[1].dueDate).toBe("2028-03-01");
    expect(occurrences()[14].dueDate).toBe("2026-10-26");
  });

  it.each([0, 1.5])("rejects invalid duration %s", (durationDays) => {
    expect(() =>
      materialize({ ...sixWeekPlan(), durationDays }, "a", "2026-09-21"),
    ).toThrow("finite duration");
  });
  it.each([-1, 42, 0.5])("rejects out-of-range offset %s", (dayOffset) => {
    const plan = sixWeekPlan();
    plan.entries[0].dayOffset = dayOffset;
    expect(() => materialize(plan, "a", "2026-09-21")).toThrow(
      "schedule entry",
    );
  });
  it("rejects duplicate entry identities", () => {
    const plan = sixWeekPlan();
    plan.entries.push(plan.entries[0]);
    expect(() => materialize(plan, "a", "2026-09-21")).toThrow(
      "schedule entry",
    );
  });

  it("leaves legacy finite and indefinite cycles available without capabilities", () => {
    expect(delivery("cycle", {})).toBe("legacy_cycle");
    const cycle = {
      startDate: "2026-09-21",
      daysPerWeek: 3,
      cycle: ["A", "B"],
      fromIndex: 0,
    };
    expect(
      buildOccurrences({ ...cycle, durationWeeks: 1 }).map((row) => [
        row.workoutId,
        row.dueDate,
      ]),
    ).toEqual([
      ["A", "2026-09-21"],
      ["B", "2026-09-23"],
      ["A", "2026-09-26"],
    ]);
    expect(
      buildOccurrences({
        ...cycle,
        durationWeeks: null,
        horizonDate: "2026-09-27",
      }),
    ).toHaveLength(3);
    expect(delivery("explicit", {})).toBe("update_required");
    expect(delivery("explicit", { explicitSchedule: 1 })).toBe(
      "update_required",
    );
    expect(delivery("explicit", { explicitSchedule: 1, prescription: 2 })).toBe(
      "update_required",
    );
    expect(delivery("explicit", { explicitSchedule: 1, prescription: 1 })).toBe(
      "explicit",
    );
  });

  it("retains symbolic percentages without a max and pins measured evidence without unit conversion", () => {
    const load = { kind: "percent_1rm" as const, percent: 75 };
    expect(resolveLoad(load)).toEqual({ prescribed: load });
    const max = { value: 200, unit: "lb" as const, measuredAt: "2026-09-01" };
    const result = resolveLoad(load, max);
    max.value = 300;
    expect(result).toEqual({
      prescribed: load,
      resolved: { value: 150, unit: "lb" },
      basis: { ...max, value: 200 },
    });
  });

  it("pins offline execution while a server publish changes the same future occurrence", () => {
    const rows = occurrences();
    const cached = structuredClone(rows[0]);
    const execution = startCached(cached, "offline-session", {
      squat: { value: 100, unit: "kg", measuredAt: "2026-09-01" },
    });
    const updated = structuredClone(rows[0]);
    updated.revisionId = "programme-v2";
    updated.prescription.workoutRevisionId = "workout-v2";
    updated.prescription.exercises[0].sets[0].load = {
      kind: "absolute",
      value: 99,
      unit: "kg",
    };
    const committed = publish(rows, 1, 1, [updated], "2026-09-20");
    cached.prescription.exercises[0].sets[0].reps = 99;
    const reconciled = reconcile(committed.occurrences[0], execution);
    expect(reconciled.disposition).toBe("needs_reconciliation");
    expect(
      reconciled.executed.snapshot.prescription.exercises[0].sets[0].reps,
    ).toBe(8);
    expect(reconciled.executed.loads[0][0]).toMatchObject({
      resolved: { value: 70, unit: "kg" },
    });
    expect(committed.occurrences[0].state).toBe("pending");
    expect(reconcile(committed.occurrences[0], execution)).toEqual(reconciled);
    expect(reconcile(rows[0], execution).disposition).toBe(
      "complete_occurrence",
    );
    expect(() =>
      publish(
        committed.occurrences,
        committed.version,
        1,
        [updated],
        "2026-09-20",
      ),
    ).toThrow("Revision conflict");
    expect(committed.occurrences[1]).toEqual(rows[1]);
    expect(rows[0].revisionId).toBe("programme-v1");
  });

  it.each([
    { state: "started" as const },
    { state: "completed" as const },
    { protectedEdit: true },
    { dueDate: "2026-09-20" },
  ])(
    "protects known active/completed/rescheduled/overridden/past occurrences %j",
    (change) => {
      const rows = occurrences();
      Object.assign(rows[0], change);
      expect(() =>
        publish(rows, 1, 1, [occurrences()[0]], "2026-09-20"),
      ).toThrow("Protected");
    },
  );

  it("rejects mismatched, duplicate, past or active replacements atomically", () => {
    const rows = occurrences();
    for (const change of [
      { entryId: "unknown" },
      { assignmentId: "other" },
      { dueDate: "2026-09-20" },
      { state: "started" as const },
    ]) {
      expect(() =>
        publish(rows, 1, 1, [{ ...rows[0], ...change }], "2026-09-20"),
      ).toThrow("Protected");
    }
    expect(() => publish(rows, 1, 1, [rows[0], rows[0]], "2026-09-20")).toThrow(
      "Duplicate",
    );
    expect(() => startCached({ ...rows[0], state: "completed" }, "s")).toThrow(
      "already started",
    );
    const execution = startCached(rows[0], "s");
    expect(() =>
      reconcile({ ...rows[0], assignmentId: "other" }, execution),
    ).toThrow("mismatch");
    expect(() => reconcile(rows[1], execution)).toThrow("mismatch");
  });
});
