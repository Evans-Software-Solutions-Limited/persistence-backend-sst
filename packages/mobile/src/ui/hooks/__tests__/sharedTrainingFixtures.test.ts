/**
 * Design H test 5 (PER-113): the phone and the server give the same output
 * for one seeded week. The server suite
 * (microservices/core/…/training/__tests__/training.integration.test.ts)
 * holds `GET /users/me/muscle-volume` to `SEEDED_WEEK_EXPECTED`; this holds
 * the phone's own You page pipeline to the same numbers, from the same
 * workouts, with muscles resolved the way the phone resolves them (cached
 * exercises carrying catalogue ids, named by the muscle_groups list).
 */
import {
  CATALOGUE_NAME_FOR_KEY,
  trainNextAndRest,
} from "@persistence/training-metrics";
import {
  SEEDED_WEEK_EXPECTED,
  SEEDED_WEEK_RECORD_EXERCISE_IDS,
  SEEDED_WEEK_SESSIONS,
} from "@persistence/training-metrics/fixtures";
import type { Exercise } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";
import { musclesLookup } from "@/ui/hooks/useTrainingLog";
import {
  musclesForSessions,
  sessionsBetween,
  topLifts,
  trainingTotals,
} from "@/domain/services/youPage";

const muscleId = (name: string) =>
  `mg-${name.toLowerCase().replace(/\s+/g, "-")}`;
const referenceList = [
  ...new Set([...Object.values(CATALOGUE_NAME_FOR_KEY), "Full Body"]),
].map((name) => ({ id: muscleId(name), name }));

const ids = (keys: readonly string[]) =>
  keys.map((k) => muscleId(CATALOGUE_NAME_FOR_KEY[k]!));

// Cached exercises as the API sends them: muscle groups are catalogue ids.
const exercises = new Map<string, Exercise>();
for (const s of SEEDED_WEEK_SESSIONS)
  for (const e of s.exercises)
    exercises.set(e.exerciseId, {
      id: e.exerciseId,
      name: e.name,
      primaryMuscleGroups: (e.primary.length
        ? ids(e.primary)
        : [muscleId("Full Body")]) as Exercise["primaryMuscleGroups"],
      secondaryMuscleGroups: ids(
        e.secondary,
      ) as Exercise["secondaryMuscleGroups"],
    } as Exercise);

const sessions: WorkoutSession[] = SEEDED_WEEK_SESSIONS.map((s) => ({
  id: s.id,
  userId: "athlete",
  workoutId: null,
  name: s.name,
  status: "completed",
  startedAt: s.startedAt,
  completedAt: s.completedAt,
  retrospectiveDurationSeconds: s.durationSeconds,
  notes: null,
  exercises: s.exercises.map((e, i) => ({
    id: `${s.id}:${i}`,
    sessionId: s.id,
    exerciseId: e.exerciseId,
    exerciseName: e.name,
    sortOrder: i,
    supersetGroup: null,
    isSubstituted: e.isSubstituted,
    originalExerciseId: null,
    notes: null,
    sets: e.sets.map((set, n) => ({
      id: set.id,
      sessionExerciseId: `${s.id}:${i}`,
      setNumber: n + 1,
      weightKg: set.weightKg,
      reps: set.reps,
      rpe: null,
      durationSeconds: null,
      distanceMeters: null,
      isCompleted: set.isCompleted,
      completedAt: null,
    })),
  })),
}));

const records: PersonalRecord[] = SEEDED_WEEK_RECORD_EXERCISE_IDS.map(
  (exerciseId) => ({
    id: `pr-${exerciseId}`,
    userId: "athlete",
    exerciseId,
    exerciseName: "Back squat",
    recordType: "1rm",
    value: 105,
    achievedAt: "2026-11-18T08:10:00.000Z",
    sessionId: SEEDED_WEEK_SESSIONS[1]!.id,
    setId: null,
  }),
);

describe("shared phone/server week (design H test 5)", () => {
  const from = new Date("2026-11-16T00:00:00.000Z");
  const to = new Date("2026-11-22T23:59:59.999Z");
  const week = sessionsBetween(sessions, from, to);
  const musclesOf = musclesLookup([...exercises.values()], referenceList);

  it("gives the server's muscle rows and Train next / Rest", () => {
    const rows = musclesForSessions(week, musclesOf);
    expect(rows.map(({ group, ...r }) => ({ muscle: group, ...r }))).toEqual(
      SEEDED_WEEK_EXPECTED.muscles,
    );
    const split = trainNextAndRest(rows);
    expect(split.trainNext.map((r) => r.group)).toEqual(
      SEEDED_WEEK_EXPECTED.trainNext,
    );
    expect(split.rest.map((r) => r.group)).toEqual(SEEDED_WEEK_EXPECTED.rest);
  });

  it("gives the server's totals", () => {
    expect(trainingTotals(week)).toEqual(SEEDED_WEEK_EXPECTED.totals);
  });

  it("gives the server's top lifts", () => {
    expect(
      topLifts(week, records, from).map((l) => ({
        exerciseId: l.exerciseId,
        oneRepMaxKg: l.oneRepMaxKg,
        isRecord: l.isRecord,
      })),
    ).toEqual(SEEDED_WEEK_EXPECTED.topLifts);
  });
});
