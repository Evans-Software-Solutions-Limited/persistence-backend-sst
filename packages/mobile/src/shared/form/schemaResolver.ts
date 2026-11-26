import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { TObject } from "@sinclair/typebox";
import {
  DefaultErrorFunction,
  GetErrorFunction,
  SetErrorFunction,
  ValueErrorType,
  type ErrorFunction,
} from "@sinclair/typebox/errors";
import { Value } from "@sinclair/typebox/value";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";

/**
 * react-hook-form + TypeBox (PER-147). Every form validates through
 * `schemaResolver`, so the rules live in one TypeBox schema per form, written
 * with the same keywords (`minLength`, `maximum`, `pattern`…) the Elysia
 * routes use. The server still has the final say: see `serverErrors.ts`.
 *
 * Copy: TypeBox's own messages are English but not ours ("Expected string
 * length greater or equal to 1"). A schema carries the form's copy in
 * `errorMessage`, either one string for any failure or one per failure kind:
 *
 *   Type.String({ pattern: "\\S", errorMessage: "Add a first name." })
 *   Type.Array(…, { errorMessage: { ArrayMinItems: "Give 2 options." } })
 */

type ErrorKind = keyof typeof ValueErrorType;
export type ErrorMessage = string | Partial<Record<ErrorKind, string>>;

export const formErrorFunction: ErrorFunction = (param) => {
  const custom = (param.schema as { errorMessage?: ErrorMessage }).errorMessage;
  if (typeof custom === "string") return custom;
  const kind = ValueErrorType[param.errorType] as ErrorKind;
  return custom?.[kind] ?? DefaultErrorFunction(param);
};

/** Installed once, on first import; harmless to call again. */
export function installFormMessages(): void {
  if (GetErrorFunction() !== formErrorFunction) {
    SetErrorFunction(formErrorFunction);
  }
}
installFormMessages();

export interface SchemaResolverOptions<V> {
  /**
   * What the schema checks, when it isn't the raw input: e.g. trimmed text,
   * because the server trims before it checks. Submit still receives the raw
   * values; the container maps them to the API as it did before. `context`
   * is react-hook-form's `context` option: screen state the rules depend on
   * that isn't typed into the form (e.g. how many meals are ticked).
   */
  prepare?: (values: V, context?: unknown) => unknown;
  /**
   * Rules between fields that a JSON schema can't say (a lowest number above
   * the highest). Runs on the prepared values with the schema, and returns
   * `{ "dotted.path": "message" }`; empty (or undefined values) when fine.
   */
  refine?: (prepared: never) => Partial<Record<string, string>>;
}

/**
 * A react-hook-form resolver from a TypeBox object schema. Wraps
 * `@hookform/resolvers/typebox` so it can check prepared values and run
 * cross-field rules, and so every message comes from the schema.
 */
export function schemaResolver<V extends FieldValues>(
  schema: TObject,
  options: SchemaResolverOptions<V> = {},
): Resolver<V> {
  installFormMessages();
  const base = typeboxResolver(schema) as unknown as Resolver<FieldValues>;
  return async (values, context, opts) => {
    const prepared = (options.prepare?.(values, context) ??
      values) as FieldValues;
    const result = await base(
      prepared,
      context,
      opts as unknown as Parameters<Resolver<FieldValues>>[2],
    );
    const errors = { ...result.errors } as Record<string, unknown>;
    // Cross-field rules are reported alongside the schema's, but never over
    // a field the schema already refused.
    const extra = options.refine?.(prepared as never) ?? {};
    for (const [path, message] of Object.entries(extra)) {
      if (message && !messageAt(errors, path)) {
        setPath(errors, path, { type: "refine", message });
      }
    }
    if (Object.keys(errors).length > 0) {
      return { values: {}, errors: errors as FieldErrors<V> };
    }
    return { values, errors: {} };
  };
}

function setPath(target: Record<string, unknown>, path: string, leaf: object) {
  const keys = path.split(".");
  let node = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      node[key] = leaf;
      return;
    }
    node[key] ??= /^\d+$/.test(keys[i + 1]!) ? [] : {};
    node = node[key] as Record<string, unknown>;
  });
}

/** The message at a field, when there is one (a nested error's own message). */
export function messageAt(errors: unknown, path: string): string | undefined {
  let node: unknown = errors;
  for (const key of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  const message = (node as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : undefined;
}

/**
 * True when the schema accepts these (prepared) values: for a button that is
 * off until the form is valid, read during render. Submitting still goes
 * through the resolver with `handleSubmit`.
 */
export function schemaAccepts(
  schema: TObject,
  prepared: unknown,
  refine?: (prepared: never) => Partial<Record<string, string>>,
): boolean {
  if (!Value.Check(schema, prepared)) return false;
  const extra = refine?.(prepared as never) ?? {};
  return Object.values(extra).every((m) => !m);
}

/** The first message anywhere in a (nested) errors object, depth first. */
export function firstMessage(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined;
  const own = (errors as { message?: unknown }).message;
  if (typeof own === "string" && own) return own;
  for (const [key, child] of Object.entries(errors)) {
    if (key === "ref" || key === "types") continue;
    const found = firstMessage(child);
    if (found) return found;
  }
  return undefined;
}

/** Trim every string in a flat record (what the server does before it checks). */
export function trimmed<V extends object>(values: V): V {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out as V;
}
