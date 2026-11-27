import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed } from "@/shared/form";
import { MAX_STEER_LENGTH } from "@/domain/models/mealprint";

/**
 * Mealprint forms on react-hook-form (PER-134): the "Anything specific?"
 * steer on N15 (One meal and Whole day) and a meal's swap feedback on N20.
 * Both are optional free text up to the server's 200 characters (`steer`).
 */

export interface MealprintSteerValues {
  steer: string;
}

const STEER_TOO_LONG = `Keep it under ${MAX_STEER_LENGTH} characters.`;

export const mealprintSteerSchema = Type.Object({
  steer: Type.String({
    maxLength: MAX_STEER_LENGTH,
    errorMessage: STEER_TOO_LONG,
  }),
});

export const mealprintSteerResolver = schemaResolver<MealprintSteerValues>(
  mealprintSteerSchema,
  { prepare: trimmed },
);

export interface SwapFeedbackValues {
  feedback: string;
}

export const swapFeedbackSchema = Type.Object({
  feedback: Type.String({
    maxLength: MAX_STEER_LENGTH,
    errorMessage: STEER_TOO_LONG,
  }),
});

export const swapFeedbackResolver = schemaResolver<SwapFeedbackValues>(
  swapFeedbackSchema,
  { prepare: trimmed },
);
