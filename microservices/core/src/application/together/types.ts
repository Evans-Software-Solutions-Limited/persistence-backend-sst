import { t } from "elysia";
export const uuidSchema = t.String({ format: "uuid" });
export const planSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 120 }),
  exercises: t.Array(
    t.Object({
      planExerciseId: uuidSchema,
      exerciseId: uuidSchema,
      order: t.Integer({ minimum: 0, maximum: 99 }),
      targetSets: t.Integer({ minimum: 1, maximum: 100 }),
      targetReps: t.Optional(t.Integer({ minimum: 0, maximum: 10000 })),
    }),
    { minItems: 1, maxItems: 100 },
  ),
});
export const setSchema = t.Object({
  setId: uuidSchema,
  reps: t.Integer({ minimum: 0, maximum: 10000 }),
  weightKg: t.Number({ minimum: 0, maximum: 9999.99 }),
  completed: t.Boolean(),
});
export const executionSchema = t.Object({
  exercises: t.Array(
    t.Object({
      planExerciseId: uuidSchema,
      substituteExerciseId: t.Optional(t.Union([uuidSchema, t.Null()])),
      skipped: t.Boolean(),
      sets: t.Array(setSchema, { maxItems: 100 }),
    }),
    { maxItems: 100 },
  ),
});
export const commandSchema = t.Object({
  commandId: uuidSchema,
  expectedVersion: t.Integer({ minimum: 0 }),
  target: t.Object({
    kind: t.Union([t.Literal("plan"), t.Literal("execution")]),
    athleteId: t.Optional(uuidSchema),
  }),
  delegationGeneration: t.Optional(t.Integer({ minimum: 0 })),
  operation: t.Union([
    t.Object({ type: t.Literal("replacePlan"), plan: planSchema }),
    t.Object({
      type: t.Literal("upsertSet"),
      planExerciseId: uuidSchema,
      set: setSchema,
    }),
    t.Object({
      type: t.Literal("removeSet"),
      planExerciseId: uuidSchema,
      setId: uuidSchema,
    }),
    t.Object({
      type: t.Literal("substitute"),
      planExerciseId: uuidSchema,
      exerciseId: t.Union([uuidSchema, t.Null()]),
    }),
    t.Object({
      type: t.Literal("skip"),
      planExerciseId: uuidSchema,
      skipped: t.Boolean(),
    }),
    t.Object({
      type: t.Literal("rest"),
      endsAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
    }),
  ]),
});
export type TogetherCommand = typeof commandSchema.static;
export type { TogetherPlan, TogetherExecution } from "@persistence/db";
