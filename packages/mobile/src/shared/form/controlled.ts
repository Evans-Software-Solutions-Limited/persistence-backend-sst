import type {
  FieldErrors,
  FieldValues,
  Path,
  PathValue,
  UseFormReturn,
} from "react-hook-form";
import { messageAt } from "./schemaResolver";

/**
 * The coach screens keep their presenters pure: a presenter takes `values`,
 * `errors` and an `onChange(values)`, and its container owns the
 * react-hook-form instance. These two helpers are that seam.
 */

/** Write the fields that changed into the form (marks them dirty). */
export function applyValues<V extends FieldValues>(
  form: Pick<UseFormReturn<V>, "setValue" | "getValues">,
  next: V,
  options: { validate?: boolean } = {},
): void {
  const current = form.getValues();
  for (const key of Object.keys(next) as Path<V>[]) {
    const value = next[key as keyof V];
    if (Object.is(value, current[key as keyof V])) continue;
    form.setValue(key, value as PathValue<V, Path<V>>, {
      shouldDirty: true,
      shouldValidate: options.validate ?? false,
    });
  }
}

/** `{ field: "message" }` for the listed top-level fields that have one. */
export function fieldMessages<V extends FieldValues>(
  errors: FieldErrors<V>,
  keys: readonly (keyof V & string)[],
): Partial<Record<keyof V, string>> {
  const out: Partial<Record<keyof V, string>> = {};
  for (const key of keys) {
    const message = messageAt(errors, key);
    if (message) out[key] = message;
  }
  return out;
}
