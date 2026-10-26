import { tint } from "@/ui/theme/tint";
import {
  buildWorkoutSummary,
  muscleShare,
} from "@/domain/services/workoutSummary";
import {
  clock,
  summaryShareText,
  listNames,
  minutes,
  recordText,
  recordValue,
  shortDate,
  volumeText,
  weightText,
} from "../summaryFormat";

describe("summaryFormat", () => {
  it("formats clocks with and without hours", () => {
    expect(clock(3128)).toBe("52:08");
    expect(clock(3728)).toBe("1:02:08");
    expect(clock(-5)).toBe("0:00");
  });

  it("formats minutes, dates, weights and volumes", () => {
    expect(minutes(3128)).toBe("52 min");
    expect(minutes(-1)).toBe("0 min");
    expect(shortDate("2026-10-23T12:00:00.000Z")).toBe("23 Oct");
    expect(weightText(62.5, "kg")).toBe("62.5");
    expect(weightText(100, "lb")).toBe("220.5");
    expect(volumeText(4820, "kg")).toBe("4,820");
  });

  it("formats every record type", () => {
    expect(recordValue("max_weight", 65, "kg")).toEqual({
      value: "65",
      unit: "kg",
    });
    expect(recordValue("1rm", 100, "lb")).toEqual({
      value: "220.5",
      unit: "lb",
    });
    expect(recordValue("max_volume", 1500, "kg")).toEqual({
      value: "1,500",
      unit: "kg",
    });
    expect(recordValue("max_reps", 12, "kg")).toEqual({
      value: "12",
      unit: "reps",
    });
    expect(recordValue("best_time", 95, "kg")).toEqual({
      value: "1:35",
      unit: "",
    });
    expect(recordValue("longest_distance", 5000, "kg")).toEqual({
      value: "5,000",
      unit: "m",
    });
    expect(recordText({ recordType: "best_time" }, 95, "kg")).toBe("1:35");
    expect(recordText({ recordType: "max_weight" }, 65, "kg")).toBe("65 kg");
  });

  it("joins names", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["Brad"])).toBe("Brad");
    expect(listNames(["Brad", "Tom"])).toBe("Brad and Tom");
    expect(listNames(["Brad", "Tom", "Inés"])).toBe("Brad, Tom and Inés");
  });

  it("tints a token", () => {
    expect(tint("#22D3EE", 0.25)).toBe("rgba(34,211,238,0.25)");
  });
});

describe("summaryShareText", () => {
  const model = buildWorkoutSummary(
    {
      id: "l",
      userId: "u",
      workoutId: null,
      name: "Run",
      status: "completed",
      startedAt: "2026-10-23T12:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "e",
          sessionId: "l",
          exerciseId: "run",
          exerciseName: "Run",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "s",
              sessionExerciseId: "e",
              setNumber: 1,
              weightKg: null,
              reps: null,
              rpe: null,
              durationSeconds: 600,
              distanceMeters: 2000,
              isCompleted: true,
              completedAt: null,
            },
          ],
        },
      ],
    },
    600,
  );
  const base = {
    model,
    muscles: muscleShare([]),
    records: [],
    rating: null,
    unit: "kg" as const,
  };
  it("names a set with neither weight nor reps by its number", () => {
    expect(summaryShareText("details", base)).toContain("Run: set 1");
  });
  it("still reads without a roster", () => {
    expect(summaryShareText("together", base)).toContain(
      "Trained together with \nRun · 23 Oct · 10 min",
    );
  });
});
