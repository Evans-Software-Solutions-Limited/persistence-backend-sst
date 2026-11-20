import {
  muscleCredit,
  trainNextAndRest,
} from "@/domain/services/trainingMetrics/muscleCredit";
import {
  clockTime,
  dayMonth,
  deltaText,
  hoursMinutes,
  liftRows,
  minutesText,
  restLine,
  totalsStrip,
  trainNextLine,
  volumeShort,
  weekday,
  whenLabel,
} from "../youFormat";

describe("youFormat", () => {
  it("formats volume in tonnes, or pounds for imperial", () => {
    expect(volumeShort(24_100, "kg")).toBe("24.1 t");
    expect(volumeShort(0, "kg")).toBe("0.0 t");
    expect(volumeShort(1000, "lb")).toBe("2,205 lb");
  });

  it("formats durations, times and dates", () => {
    expect(hoursMinutes(4 * 3600 + 5 * 60)).toBe("4h 05m");
    expect(hoursMinutes(-5)).toBe("0h 00m");
    expect(minutesText(3480)).toBe("58 min");
    const d = new Date(2026, 9, 26, 7, 10);
    expect(weekday(d.toISOString())).toBe("Mon");
    expect(clockTime(d.toISOString())).toBe("07:10");
    expect(dayMonth(d)).toBe("26 Oct");
    expect(whenLabel(d.toISOString(), new Date(2026, 9, 26, 20))).toBe("Today");
    expect(whenLabel(d.toISOString(), new Date(2026, 9, 28))).toBe("26 Oct");
  });

  it("signs a change with a true minus", () => {
    expect(deltaText(0.4, "this week")).toBe("+0.4 this week");
    expect(deltaText(-0.3, "this month")).toBe("−0.3 this month");
    expect(deltaText(0.01, "this week")).toBe("±0.0 this week");
  });

  it("builds the strip", () => {
    expect(
      totalsStrip(
        { workouts: 4, volumeKg: 24_100, durationSeconds: 14_700, sets: 0 },
        "kg",
      ),
    ).toEqual({
      workouts: "4",
      volume: "24.1 t",
      time: "4h 05m",
    });
  });

  it("formats lifts with the best set and the estimated 1RM to half a unit", () => {
    const [row] = liftRows(
      [
        {
          exerciseId: "s",
          name: "Back squat",
          weightKg: 120,
          reps: 7,
          startedAt: new Date(2026, 9, 26, 7).toISOString(),
          oneRepMaxKg: 148.2,
          isRecord: true,
        },
      ],
      "kg",
    );
    expect(row).toEqual({
      key: "s",
      rank: "1",
      name: "Back squat",
      detail: "120 kg × 7 · Mon",
      value: "148.0 kg",
      gold: true,
    });
    expect(
      liftRows(
        [
          {
            ...row!,
            exerciseId: "b",
            weightKg: 57.5,
            reps: 6,
            startedAt: new Date(2026, 9, 29).toISOString(),
            oneRepMaxKg: 69,
            isRecord: false,
          } as never,
        ],
        "kg",
      )[0]!.detail,
    ).toBe("57.5 kg × 6 · Thu");
  });

  it("writes the Train next and Rest lines", () => {
    const split = trainNextAndRest(
      muscleCredit([
        {
          primary: ["chest", "back", "shoulders"],
          secondary: [],
          completedSets: 10,
        },
        {
          primary: ["quadriceps", "glutes", "biceps", "forearms"],
          secondary: [],
          completedSets: 6,
        },
        { primary: ["triceps"], secondary: [], completedSets: 4 },
      ]),
    );
    expect(trainNextLine(split.trainNext)).toEqual({
      text: "Hamstrings, core, calves",
      hint: "Short of their week · a lower day sorts it",
    });
    expect(restLine(split.rest)).toEqual({
      text: "Back, chest, shoulders",
      hint: "Hit their week · nice work",
    });
    expect(
      trainNextLine(
        trainNextAndRest(
          muscleCredit([
            {
              primary: ["quadriceps", "hamstrings", "glutes", "calves", "core"],
              secondary: [],
              completedSets: 10,
            },
          ]),
        ).trainNext,
      ),
    ).toEqual({
      text: "Back, chest, shoulders",
      hint: "Short of their week · an upper day sorts it",
    });
    expect(trainNextLine([])).toBeNull();
    expect(restLine([])).toBeNull();
  });

  it("labels a date-only reading by its local day (Inspector Brad #541)", () => {
    expect(whenLabel("2026-11-20", new Date(2026, 10, 20, 0, 5))).toBe("Today");
    expect(whenLabel("2026-11-20", new Date(2026, 10, 20, 23, 55))).toBe(
      "Today",
    );
    expect(dayMonth("2026-11-19")).toBe("19 Nov");
  });
});
