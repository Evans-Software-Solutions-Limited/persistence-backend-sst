import type { ExplicitRevision, Load } from "../model";

/** Mon/Wed/Fri, week 3 has only Mon/Fri, week 4 deloads, week 6 adds Friday PM. */
export function sixWeekPlan(): ExplicitRevision {
  return {
    revisionId: "programme-v1",
    mode: "explicit",
    durationDays: 42,
    restLabels: [{ dayOffset: 1, label: "Recovery" }],
    entries: Array.from({ length: 6 }, (_, week) => {
      const days = week === 2 ? [0, 4] : week === 5 ? [0, 2, 4, 4] : [0, 2, 4];
      return days.map((day, slot) => {
        const load: Load =
          slot === 0
            ? { kind: "percent_1rm", percent: week === 3 ? 50 : 70 + week * 2 }
            : {
                kind: "absolute",
                value: week === 3 ? 40 : 60 + week * 5,
                unit: "lb",
              };
        return {
          entryId: `week-${week + 1}-session-${slot + 1}`,
          dayOffset: week * 7 + day,
          order: slot,
          phase: week === 3 ? "Deload" : "Build",
          prescription: {
            version: 1 as const,
            workoutRevisionId: `workout-${week}-${slot}`,
            exercises: [
              {
                exerciseId: "squat",
                sets: [
                  {
                    reps: week === 3 ? 5 : 8,
                    load,
                    rpe: 7,
                    tempo: "3010",
                    restSeconds: 120,
                  },
                  {
                    reps: 4,
                    load: {
                      kind: "absolute" as const,
                      value: 20,
                      unit: "kg" as const,
                    },
                    rir: 3,
                    durationSeconds: 30,
                    distance: { value: 10, unit: "m" as const },
                  },
                ],
              },
            ],
          },
        };
      });
    }).flat(),
  };
}
