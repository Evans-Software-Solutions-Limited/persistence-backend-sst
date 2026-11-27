import { MEAL_PLAN_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed } from "@/shared/form";

/**
 * PER-135 coach plan forms on react-hook-form with TypeBox: the note sent
 * with a plan (C5) or changed later, and the plan and meal names in the
 * coach's editor (C3). Limits are the shared `MEAL_PLAN_LIMITS`, checked on
 * trimmed text as the API checks it. The server keeps the final say.
 */

export const NOTE_MAX = MEAL_PLAN_LIMITS.noteMax;
export const NOTE_MESSAGE = `Keep the note under ${NOTE_MAX} characters.`;

export interface CoachNoteValues {
  note: string;
}

export const coachNoteSchema = Type.Object({
  note: Type.String({ maxLength: NOTE_MAX, errorMessage: NOTE_MESSAGE }),
});

export const coachNoteResolver = schemaResolver<CoachNoteValues>(
  coachNoteSchema,
  { prepare: trimmed },
);

export const PLAN_NAME_MAX = MEAL_PLAN_LIMITS.storedNameMax;
export const MEAL_NAME_MAX = MEAL_PLAN_LIMITS.storedMealNameMax;
export const PLAN_NAME_MESSAGE = `Give the plan a name of up to ${PLAN_NAME_MAX} characters.`;
export const MEAL_NAME_MESSAGE = `Give each meal a name of up to ${MEAL_NAME_MAX} characters.`;

export interface CoachPlanValues {
  name: string;
  meals: { id: string; name: string }[];
}

export const coachPlanSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: PLAN_NAME_MAX,
    errorMessage: PLAN_NAME_MESSAGE,
  }),
  meals: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String({
        minLength: 1,
        maxLength: MEAL_NAME_MAX,
        errorMessage: MEAL_NAME_MESSAGE,
      }),
    }),
    { minItems: 1, maxItems: 20, errorMessage: "A plan has 1 to 20 meals." },
  ),
});

export const coachPlanResolver = schemaResolver<CoachPlanValues>(
  coachPlanSchema,
  {
    prepare: (v: CoachPlanValues) => ({
      name: v.name.trim(),
      meals: v.meals.map((m) => ({ id: m.id, name: m.name.trim() })),
    }),
  },
);
