import { MEAL_PLAN_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed, type ServerFieldMap } from "@/lib/form";
import {
  PLAN_ITEMS_PER_MEAL_MAX,
  PLAN_MEALS_MAX,
  PORTION_MAX,
  type PlanEditorValues,
} from "./mealPlans";

/**
 * The coach's plan forms (PER-135) on react-hook-form with TypeBox. Limits
 * are the shared `MEAL_PLAN_LIMITS`, checked on trimmed text as the API
 * checks it: a plan name up to 80 characters, a meal name up to 40, a note up
 * to 500. The server keeps the final say; its 400s map onto these fields.
 */

export const PLAN_NAME_MAX = MEAL_PLAN_LIMITS.storedNameMax;
export const PLAN_MEAL_NAME_MAX = MEAL_PLAN_LIMITS.storedMealNameMax;
export const PLAN_NOTE_MAX = MEAL_PLAN_LIMITS.noteMax;

export const PLAN_NAME_MESSAGE = `Give the plan a name of up to ${PLAN_NAME_MAX} characters.`;
export const MEAL_NAME_MESSAGE = `Give each meal a name of up to ${PLAN_MEAL_NAME_MAX} characters.`;
export const MEALS_MESSAGE = `A plan has 1 to ${PLAN_MEALS_MAX} meals.`;
export const ITEMS_MESSAGE = `A meal holds up to ${PLAN_ITEMS_PER_MEAL_MAX} foods.`;
export const PORTION_MESSAGE = `Portions must be more than 0 and up to ${PORTION_MAX}.`;
export const NOTE_MESSAGE = `Keep the note under ${PLAN_NOTE_MAX} characters.`;

const macros = Type.Object({
  kcal: Type.Number({ minimum: 0 }),
  proteinG: Type.Number({ minimum: 0 }),
  carbsG: Type.Number({ minimum: 0 }),
  fatG: Type.Number({ minimum: 0 }),
});

export const planEditorSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: PLAN_NAME_MAX,
    errorMessage: PLAN_NAME_MESSAGE,
  }),
  meals: Type.Array(
    Type.Object({
      key: Type.String(),
      name: Type.String({
        minLength: 1,
        maxLength: PLAN_MEAL_NAME_MAX,
        errorMessage: MEAL_NAME_MESSAGE,
      }),
      logSlot: Type.String(),
      items: Type.Array(
        Type.Object({
          key: Type.String(),
          name: Type.String(),
          serving: Type.String(),
          source: Type.Object({ kind: Type.String() }),
          perServing: macros,
          // The server's rule (servings > 0, up to 100): a plan built on the
          // phone may hold less than the steppers' quarter step.
          servings: Type.Number({
            exclusiveMinimum: 0,
            maximum: PORTION_MAX,
            errorMessage: PORTION_MESSAGE,
          }),
        }),
        { maxItems: PLAN_ITEMS_PER_MEAL_MAX, errorMessage: ITEMS_MESSAGE },
      ),
    }),
    { minItems: 1, maxItems: PLAN_MEALS_MAX, errorMessage: MEALS_MESSAGE },
  ),
});

export const planEditorResolver = schemaResolver<PlanEditorValues>(
  planEditorSchema,
  {
    prepare: (v: PlanEditorValues) => ({
      ...v,
      name: v.name.trim(),
      meals: v.meals.map((m) => ({ ...m, name: m.name.trim() })),
    }),
  },
);

/** The API's 400 codes for a refused plan → the editor's fields. */
export const PLAN_SERVER_ERRORS: Record<
  string,
  { field: "name" | "meals"; message: string }
> = {
  invalid_plan_name: { field: "name", message: PLAN_NAME_MESSAGE },
  invalid_meal_name: { field: "meals", message: MEAL_NAME_MESSAGE },
  invalid_item: {
    field: "meals",
    message: "One of the foods can't be saved. Check the portions.",
  },
  food_not_found: {
    field: "meals",
    message: "A food in this plan is no longer available. Remove it and save.",
  },
  recipe_not_found: {
    field: "meals",
    message:
      "A recipe in this plan is no longer available. Remove it and save.",
  },
  meal_not_found: {
    field: "meals",
    message:
      "A saved meal in this plan is no longer available. Remove it and save.",
  },
};

/** Elysia's 422 schema check (`validation[].path`) → the editor's fields. */
export const PLAN_SERVER_FIELDS: ServerFieldMap<PlanEditorValues> = {
  name: { field: "name", message: PLAN_NAME_MESSAGE },
  meals: { field: "meals", message: MEALS_MESSAGE },
};

// ─── C5 Send / Change the note ────────────────────────────────────────────────

export interface NoteValues {
  note: string;
}

export const noteSchema = Type.Object({
  note: Type.String({ maxLength: PLAN_NOTE_MAX, errorMessage: NOTE_MESSAGE }),
});

export const noteResolver = schemaResolver<NoteValues>(noteSchema, {
  prepare: trimmed,
});

export const NOTE_SERVER_FIELDS: ServerFieldMap<NoteValues> = {
  note: { field: "note", message: NOTE_MESSAGE },
};
