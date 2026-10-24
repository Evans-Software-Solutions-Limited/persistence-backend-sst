import {
  formatSessionCode,
  hostDetailsFrom,
  isHostDetails,
  isPlanRows,
  newSessionCode,
  normaliseSessionCode,
  planRowLabel,
  SESSION_CODE_ALPHABET,
  startedAgo,
} from "../planDetails";
import type { WorkoutSession } from "../../../domain/models/session";

const set = (reps: number | null) =>
  ({
    id: `s${reps}`,
    sessionExerciseId: "e",
    setNumber: 1,
    weightKg: null,
    reps,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    completed: false,
    completedAt: null,
  }) as unknown as WorkoutSession["exercises"][number]["sets"][number];
const exercise = (
  name: string,
  sortOrder: number,
  sets: ReturnType<typeof set>[],
  isSubstituted = false,
) =>
  ({
    id: `e${sortOrder}`,
    sessionId: "s",
    exerciseId: `x${sortOrder}`,
    exerciseName: name,
    sortOrder,
    supersetGroup: null,
    isSubstituted,
    originalExerciseId: null,
    notes: null,
    sets,
  }) as unknown as WorkoutSession["exercises"][number];

it("mints six-character codes from the unambiguous alphabet and reads them back loosely", () => {
  const code = newSessionCode((n) => new Uint8Array(n).fill(0));
  expect(code).toBe("AAAAAA");
  expect(newSessionCode((n) => new Uint8Array(n).fill(255))).toBe("999999");
  expect(SESSION_CODE_ALPHABET).not.toMatch(/[01IO]/);
  expect(normaliseSessionCode(" 4kq-928 ")).toBe("4KQ928");
  expect(normaliseSessionCode("4KQ 928")).toBe("4KQ928");
  expect(normaliseSessionCode("4KQ-9281")).toBeUndefined();
  expect(normaliseSessionCode("4KQ-9O8")).toBeUndefined();
  expect(normaliseSessionCode("persistencemobile://x")).toBeUndefined();
  expect(formatSessionCode("4KQ928")).toBe("4KQ-928");
  expect(formatSessionCode("short")).toBe("short");
});

it("validates plan rows and optional advert details strictly", () => {
  expect(isPlanRows([{ name: "Squat", sets: 4, reps: 6 }])).toBe(true);
  expect(isPlanRows([{ name: "Squat", sets: 4, reps: null }])).toBe(true);
  expect(isPlanRows([])).toBe(true);
  expect(isPlanRows([{ name: "", sets: 4, reps: 6 }])).toBe(false);
  expect(isPlanRows([{ name: "Squat", sets: 0, reps: 6 }])).toBe(false);
  expect(isPlanRows([{ name: "Squat", sets: 4, reps: 1.5 }])).toBe(false);
  expect(isPlanRows([{ name: "x".repeat(81), sets: 1, reps: null }])).toBe(
    false,
  );
  expect(
    isPlanRows(new Array(21).fill({ name: "a", sets: 1, reps: null })),
  ).toBe(false);
  expect(isPlanRows("nope")).toBe(false);
  expect(isHostDetails({})).toBe(true);
  expect(isHostDetails({ startedAt: 1, plan: [], code: "4KQ928" })).toBe(true);
  expect(isHostDetails({ startedAt: 0 })).toBe(false);
  expect(isHostDetails({ startedAt: "x" })).toBe(false);
  expect(isHostDetails({ code: "4kq928" })).toBe(false);
  expect(isHostDetails({ plan: [{ name: "a", sets: 1 }] })).toBe(false);
});

it("turns the live workout into plan rows in order, skipping substitutes, with the first planned reps", () => {
  const details = hostDetailsFrom({
    startedAt: "2026-10-23T11:30:00.000Z",
    exercises: [
      exercise("Romanian Deadlift", 1, [set(null), set(10)]),
      exercise("  Barbell Back Squat  ", 0, [set(6), set(6), set(6), set(6)]),
      exercise("Swapped", 2, [set(5)], true),
      exercise("   ", 3, []),
    ],
  });
  expect(details.startedAt).toBe(Date.parse("2026-10-23T11:30:00.000Z"));
  expect(details.plan).toEqual([
    { name: "Barbell Back Squat", sets: 4, reps: 6 },
    { name: "Romanian Deadlift", sets: 2, reps: 10 },
    { name: "Exercise", sets: 1, reps: null },
  ]);
  expect(
    hostDetailsFrom({ startedAt: "not a date", exercises: [] }).startedAt,
  ).toBeGreaterThan(0);
});

it("labels rows and relative start times the way the canvas reads them", () => {
  expect(planRowLabel({ name: "a", sets: 4, reps: 6 })).toBe("4 × 6");
  expect(planRowLabel({ name: "a", sets: 3, reps: null })).toBe("3 sets");
  expect(planRowLabel({ name: "a", sets: 1, reps: null })).toBe("1 set");
  const now = Date.parse("2026-10-23T12:00:00Z");
  expect(startedAgo(now - 20_000, now)).toBe("started just now");
  expect(startedAgo(now - 60_000, now)).toBe("started 1 minute ago");
  expect(startedAgo(now - 18 * 60_000, now)).toBe("started 18 minutes ago");
  expect(startedAgo(now - 125 * 60_000, now)).toBe("started 2 hours ago");
  expect(startedAgo(now - 60 * 60_000, now)).toBe("started 1 hour ago");
  expect(startedAgo(now + 60_000, now)).toBe("started just now");
});
