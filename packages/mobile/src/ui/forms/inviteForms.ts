import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed } from "@/shared/form";

/**
 * The athlete's invite flow as react-hook-forms (PER-147): entering a code
 * (Join) and the C11j consent tick (Accept). The server decides whether a
 * code works; its refusals land on the code field with the screen's copy.
 */

export interface InviteCodeValues {
  code: string;
}

export const inviteCodeSchema = Type.Object({
  code: Type.String({
    minLength: 1,
    maxLength: 6,
    errorMessage: "Enter the code your coach shared.",
  }),
});

export const inviteCodeResolver = schemaResolver<InviteCodeValues>(
  inviteCodeSchema,
  { prepare: trimmed },
);

export interface InviteConsentValues {
  agreed: boolean;
}

export const inviteConsentSchema = Type.Object({
  agreed: Type.Literal(true, {
    errorMessage: "Please confirm you agree to share your data.",
  }),
});

export const inviteConsentResolver =
  schemaResolver<InviteConsentValues>(inviteConsentSchema);
