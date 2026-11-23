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

/** The form → the API's profile fields, or the field errors to show. */
export function toInput(
  v: WhoValues,
):
  | { ok: true; input: NewProfileInput }
  | { ok: false; errors: Partial<Record<keyof WhoValues, string>> } {
  const errors: Partial<Record<keyof WhoValues, string>> = {};
  if (!v.first.trim()) errors.first = "Add a first name.";
  const contact = parseContact(v.contact);
  if (contact.kind === "invalid") {
    errors.contact = "Enter an email address or a mobile number.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const blank = (s: string) => (s.trim() ? s.trim() : null);
  return {
    ok: true,
    input: {
      displayName: joinName(v.first, v.last),
      contactEmail: contact.kind === "email" ? contact.value : null,
      contactPhone: contact.kind === "phone" ? contact.value : null,
      goal: blank(v.goal),
      privateNotes: blank(v.notes),
    },
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
