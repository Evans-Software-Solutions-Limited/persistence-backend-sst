import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed } from "@/lib/form";

/**
 * Reply to a check-in (C3.3, PER-147). The API takes up to 2,000 characters
 * (`REPLY_MAX`); the button stays off until there is something to send.
 */
export interface ReplyValues {
  reply: string;
}

export const REPLY_MAX = 2000;

export const replySchema = Type.Object({
  reply: Type.String({
    minLength: 1,
    maxLength: REPLY_MAX,
    errorMessage: {
      StringMinLength: "Write a reply.",
      StringMaxLength: "Keep the reply under 2,000 characters.",
    },
  }),
});

export const replyResolver = schemaResolver<ReplyValues>(replySchema, {
  prepare: trimmed,
});
