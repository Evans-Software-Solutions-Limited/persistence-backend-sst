import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * The server keeps the final say (PER-147). When it refuses a submit with
 * field errors, they land on the form's fields:
 *
 * - Elysia's schema check (422 `VALIDATION`) sends `validation: [{ path:
 *   "/displayName", message }]`.
 * - Hand-written route checks send `errors: [{ at, message }]` (for example
 *   422 `invalid_questions`, where `at` is the question's index), or a single
 *   `field` with the message.
 *
 * Each form says which server field goes to which of its fields, and the
 * copy to show there (the server's own text is for developers). A refusal
 * that names no mapped field returns false, so the container shows its
 * banner as it did before.
 */

export interface ServerFieldIssue {
  /** Dotted, e.g. "displayName" or "questions.2.prompt". */
  path: string;
  message: string;
}

interface ErrorLike {
  status?: unknown;
  body?: unknown;
}

const FIELD_STATUSES = new Set([400, 409, 422]);

const dotted = (raw: string) =>
  raw
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");

/** The field-level problems in a refused request, in the server's order. */
export function serverFieldIssues(
  error: unknown,
  options: ServerIssueOptions = {},
): ServerFieldIssue[] {
  if (!error || typeof error !== "object") return [];
  const { status, body } = error as ErrorLike;
  if (typeof status !== "number" || !FIELD_STATUSES.has(status)) return [];
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const out: ServerFieldIssue[] = [];
  const text = (v: unknown, fallback: string) =>
    typeof v === "string" && v ? v : fallback;
  if (Array.isArray(b.validation)) {
    for (const v of b.validation as Record<string, unknown>[]) {
      if (typeof v?.path !== "string") continue;
      out.push({
        path: dotted(v.path),
        message: text(v.message, text(v.summary, "Check this.")),
      });
    }
  }
  if (Array.isArray(b.errors)) {
    for (const e of b.errors as Record<string, unknown>[]) {
      const at = e?.at;
      // `at: -1` (or "") is about the whole list, not one field.
      if (typeof at === "number" ? at < 0 : typeof at !== "string" || !at) {
        continue;
      }
      const prefix = options.errorsAt ? `${options.errorsAt}.` : "";
      out.push({ path: `${prefix}${at}`, message: text(e.message, "") });
    }
  }
  if (typeof b.field === "string") {
    out.push({ path: dotted(b.field), message: text(b.message, "") });
  }
  // Some route checks only say it in words ("timeLocal must be HH:MM",
  // "selected needs 1–500 clientIds"): the field is the word that names it.
  if (
    out.length === 0 &&
    options.fieldsInMessage &&
    typeof b.message === "string"
  ) {
    const named = options.fieldsInMessage.find((f) =>
      new RegExp(`\\b${f}\\b`).test(b.message as string),
    );
    if (named) out.push({ path: named, message: b.message });
  }
  return out;
}

export interface ServerIssueOptions {
  /** Prefix for `errors[].at` (e.g. "questions" → "questions.2"). */
  errorsAt?: string;
  /** Field names to look for in a message when nothing else names one. */
  fieldsInMessage?: readonly string[];
}

export type ServerFieldMap<V extends FieldValues> = Record<
  string,
  {
    /** A field path; `{n}` stands for the index the server named. */
    field: Path<V> | `${string}{n}${string}`;
    message?: string;
  }
>;

/**
 * Put the server's field errors on the form. A server path matches the
 * longest mapped prefix ("questions.2.prompt" → "questions.2" → "questions").
 * A `{n}` in a mapped field is replaced with the index found in the path, so
 * `{ questions: { field: "questions.{n}.prompt" } }` handles any question.
 * Returns true when at least one error landed on a field.
 */
export function applyServerErrors<V extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<V>,
  map: ServerFieldMap<V>,
  options: ServerIssueOptions = {},
): boolean {
  const done = new Set<string>();
  for (const issue of serverFieldIssues(error, options)) {
    const parts = issue.path.split(".");
    for (let n = parts.length; n > 0; n--) {
      const key = parts.slice(0, n).join(".");
      const entry = map[key];
      if (!entry) continue;
      const index = parts[n];
      // A `{n}` field needs the item's index. An error about the whole list
      // ("/questions") has none: leave it unmapped, so the caller's banner
      // shows instead of an error on a field that doesn't exist.
      if (entry.field.includes("{n}") && !(index && /^\d+$/.test(index))) {
        break;
      }
      const field = entry.field.replace("{n}", index ?? "") as Path<V>;
      if (!done.has(field)) {
        done.add(field);
        setError(field, {
          type: "server",
          message: entry.message ?? issue.message,
        });
      }
      break;
    }
  }
  return done.size > 0;
}
