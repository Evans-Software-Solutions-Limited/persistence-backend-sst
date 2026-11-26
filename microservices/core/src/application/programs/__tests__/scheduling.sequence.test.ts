import { describe, it, expect } from "vitest";
import {
  INDEFINITE_SEQUENCE_WEEKS,
  buildSequence,
  weekOfProgramme,
} from "../scheduling";
import { programmeOrderFields, toScheduleMode } from "../sequenceProgress";

/**
 * PER-112 (design G part 2): the pure sequence-mode helpers. Kept apart from
 * scheduling.test.ts, which design G requires to stay unchanged.
 */
describe("buildSequence", () => {
  it("finite: every workout in programme order, cycling", () => {
    expect(
      buildSequence({
        daysPerWeek: 3,
        cycle: ["a", "b"],
        durationWeeks: 2,
        fromIndex: 0,
      }),
    ).toEqual([
      { sequenceIndex: 0, workoutId: "a" },
      { sequenceIndex: 1, workoutId: "b" },
      { sequenceIndex: 2, workoutId: "a" },
      { sequenceIndex: 3, workoutId: "b" },
      { sequenceIndex: 4, workoutId: "a" },
      { sequenceIndex: 5, workoutId: "b" },
    ]);
  });

  it("finite: resumes from fromIndex and clamps a negative one", () => {
    const steps = buildSequence({
      daysPerWeek: 2,
      cycle: ["a", "b", "c"],
      durationWeeks: 2,
      fromIndex: 3,
    });
    expect(steps).toEqual([{ sequenceIndex: 3, workoutId: "a" }]);
    expect(
      buildSequence({
        daysPerWeek: 1,
        cycle: ["a"],
        durationWeeks: 1,
        fromIndex: -5,
      }),
    ).toEqual([{ sequenceIndex: 0, workoutId: "a" }]);
  });

  it("an empty cycle builds nothing", () => {
    expect(
      buildSequence({
        daysPerWeek: 3,
        cycle: [],
        durationWeeks: 4,
        fromIndex: 0,
      }),
    ).toEqual([]);
  });

  it("indefinite: tops up to the open window, and never past it", () => {
    const window = INDEFINITE_SEQUENCE_WEEKS * 2;
    expect(
      buildSequence({
        daysPerWeek: 2,
        cycle: ["a"],
        durationWeeks: null,
        fromIndex: 0,
      }),
    ).toHaveLength(window);
    const topUp = buildSequence({
      daysPerWeek: 2,
      cycle: ["a", "b"],
      durationWeeks: null,
      fromIndex: 8,
      openCount: window - 3,
    });
    expect(topUp.map((s) => s.sequenceIndex)).toEqual([8, 9, 10]);
    expect(topUp.map((s) => s.workoutId)).toEqual(["a", "b", "a"]);
    expect(
      buildSequence({
        daysPerWeek: 2,
        cycle: ["a"],
        durationWeeks: null,
        fromIndex: 8,
        openCount: window + 4,
      }),
    ).toEqual([]);
  });
});

describe("weekOfProgramme", () => {
  const base = {
    startDate: "2026-11-02",
    today: "2026-11-25",
    daysPerWeek: 3,
    nextSequenceIndex: null,
    sequenceCount: 0,
  };

  it("dated: the calendar week, clamped to the programme length", () => {
    expect(
      weekOfProgramme({ ...base, scheduleMode: "dated", durationWeeks: 8 }),
    ).toEqual({ week: 4, of: 8 });
    expect(
      weekOfProgramme({ ...base, scheduleMode: "dated", durationWeeks: 2 }),
    ).toEqual({ week: 2, of: 2 });
  });

  it("sequence: the week Next belongs to, whatever the calendar says", () => {
    const seq = { ...base, scheduleMode: "sequence" as const };
    expect(
      weekOfProgramme({ ...seq, durationWeeks: 8, nextSequenceIndex: 0 }),
    ).toEqual({ week: 1, of: 8 });
    expect(
      weekOfProgramme({ ...seq, durationWeeks: 8, nextSequenceIndex: 2 }),
    ).toEqual({ week: 1, of: 8 });
    expect(
      weekOfProgramme({ ...seq, durationWeeks: 8, nextSequenceIndex: 3 }),
    ).toEqual({ week: 2, of: 8 });
  });

  it("sequence: all done reads the last week; indefinite has no ceiling", () => {
    const seq = { ...base, scheduleMode: "sequence" as const };
    expect(
      weekOfProgramme({ ...seq, durationWeeks: 2, sequenceCount: 6 }),
    ).toEqual({ week: 2, of: 2 });
    expect(
      weekOfProgramme({
        ...seq,
        durationWeeks: null,
        nextSequenceIndex: 30,
      }),
    ).toEqual({ week: 11, of: null });
    // A zero days-per-week programme can't divide by zero.
    expect(
      weekOfProgramme({
        ...seq,
        daysPerWeek: 0,
        durationWeeks: 4,
        nextSequenceIndex: 1,
      }),
    ).toEqual({ week: 2, of: 4 });
  });
});

describe("programme order read fields", () => {
  it("anything but 'sequence' is dated", () => {
    expect(toScheduleMode("sequence")).toBe("sequence");
    expect(toScheduleMode("dated")).toBe("dated");
    expect(toScheduleMode(undefined)).toBe("dated");
    expect(toScheduleMode("weekly")).toBe("dated");
  });

  it("a dated row never carries Next, even with progress passed", () => {
    expect(
      programmeOrderFields({
        scheduleMode: "dated",
        startDate: "2026-11-02",
        today: "2026-11-25",
        durationWeeks: 8,
        daysPerWeek: 3,
        progress: {
          nextAssignmentId: "wa-1",
          nextSequenceIndex: 4,
          sequenceCount: 24,
        },
      }),
    ).toEqual({
      scheduleMode: "dated",
      nextAssignmentId: null,
      weekOfProgramme: { week: 4, of: 8 },
    });
  });

  it("a sequence row with no workouts yet reads week 1 and no Next", () => {
    expect(
      programmeOrderFields({
        scheduleMode: "sequence",
        startDate: "2026-11-25",
        today: "2026-11-25",
        durationWeeks: 4,
        daysPerWeek: 3,
        progress: undefined,
      }),
    ).toEqual({
      scheduleMode: "sequence",
      nextAssignmentId: null,
      weekOfProgramme: { week: 1, of: 4 },
    });
  });
});
