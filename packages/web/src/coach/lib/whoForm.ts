import { CLIENT_PROFILE_LIMITS } from "@persistence/form-limits";
import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed, type ServerFieldMap } from "@/lib/form";
import type { ClientProfile, NewProfileInput } from "../api/types";
import type { WhoValues } from "../who/WhoStep";
import { contactOf, joinName, parseContact, splitName } from "./people";

/** Add client · 1 Who: the form ↔ the API's profile fields. Pure. */

export const EMPTY: WhoValues = {
  first: "",
  last: "",
  contact: "",
  goal: "",
  notes: "",
};

export function valuesFrom(p: ClientProfile): WhoValues {
  const { first, last } = splitName(p.displayName);
  return {
    first,
    last,
    contact: contactOf(p),
    goal: p.goal ?? "",
    notes: p.privateNotes ?? "",
  };
}

/**
 * The Who rules (PER-147), checked on trimmed values through react-hook-form.
 * Limits match the API's profile route (`displayName` 1–80, contact email
 * 320, phone 40, goal 200, notes 4000). The name is checked as the API sees
 * it, first and last joined, not per box: a saved name reopens with every
 * later word in Last name (`splitName`), which can pass the box's typing
 * limit and must still save. The patterns are `parseContact`'s.
 */
const EMAIL = String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$`;
const PHONE = String.raw`^\+?[0-9 ()-]{6,}$`;
export const NAME_MAX = CLIENT_PROFILE_LIMITS.displayNameMax;
export const CONTACT_MESSAGE = "Enter an email address or a mobile number.";
export const NAME_MESSAGE = `Keep the name to ${NAME_MAX} characters.`;
const GOAL_MESSAGE = "Keep the goal under 200 characters.";
const NOTES_MESSAGE = "Keep the notes under 4,000 characters.";

export const whoSchema = Type.Object({
  first: Type.String({ minLength: 1, errorMessage: "Add a first name." }),
  last: Type.String(),
  contact: Type.Union(
    [
      Type.String({ maxLength: 0 }),
      Type.String({
        pattern: EMAIL,
        maxLength: CLIENT_PROFILE_LIMITS.contactEmailMax,
      }),
      Type.String({
        pattern: PHONE,
        maxLength: CLIENT_PROFILE_LIMITS.contactPhoneMax,
      }),
    ],
    { errorMessage: CONTACT_MESSAGE },
  ),
  goal: Type.String({
    maxLength: CLIENT_PROFILE_LIMITS.goalMax,
    errorMessage: GOAL_MESSAGE,
  }),
  notes: Type.String({
    maxLength: CLIENT_PROFILE_LIMITS.privateNotesMax,
    errorMessage: NOTES_MESSAGE,
  }),
});

export const whoResolver = schemaResolver<WhoValues>(whoSchema, {
  prepare: trimmed,
  // The joined name is what the API limits; the message goes on the box
  // that made it too long (Last name when there is one).
  refine: (v: WhoValues) =>
    joinName(v.first, v.last).length > NAME_MAX
      ? { [v.last ? "last" : "first"]: NAME_MESSAGE }
      : {},
});

/** Where the API's 422 field errors land on this form. */
export const WHO_SERVER_FIELDS: ServerFieldMap<WhoValues> = {
  displayName: { field: "first", message: NAME_MESSAGE },
  contactEmail: { field: "contact", message: CONTACT_MESSAGE },
  contactPhone: { field: "contact", message: CONTACT_MESSAGE },
  goal: { field: "goal", message: GOAL_MESSAGE },
  privateNotes: { field: "notes", message: NOTES_MESSAGE },
};

/** Valid form values (the resolver passed) → the API's profile fields. */
export function toInput(v: WhoValues): NewProfileInput {
  const contact = parseContact(v.contact);
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    displayName: joinName(v.first, v.last),
    contactEmail: contact.kind === "email" ? contact.value : null,
    contactPhone: contact.kind === "phone" ? contact.value : null,
    goal: blank(v.goal),
    privateNotes: blank(v.notes),
  };
}

/** Only what changed, so an edit never overwrites a field it didn't touch. */
export function changedFields(
  before: ClientProfile,
  after: NewProfileInput,
): Partial<NewProfileInput> {
  const out: Partial<NewProfileInput> = {};
  for (const key of [
    "displayName",
    "contactEmail",
    "contactPhone",
    "goal",
    "privateNotes",
  ] as const) {
    if ((before[key] ?? null) !== (after[key] ?? null)) {
      (out as Record<string, unknown>)[key] = after[key] ?? null;
    }
  }
  return out;
}
