/**
 * Shared validation for the catalogue-reference arrays on an `/exercises` body
 * (`primary_muscles`, `secondary_muscles`, `equipment_required`,
 * `accessibility_requirements`).
 *
 * Both handlers previously declared these as `t.Array(t.String({ format: "uuid" }))`
 * and relied on Elysia to reject anything else. That is a correct constraint
 * expressed uselessly: the rejection is a generic 422 whose body says
 * `Expected string to match 'uuid' format` with a JSON-pointer path, which tells
 * a client nothing it can act on and tells a human reading a sync-failure record
 * even less. The mobile app shipped for months sending muscle-group *names*
 * there, and the only signal was that opaque 422.
 *
 * So: accept `t.String()` at the schema layer and validate here, returning a 400
 * that NAMES the offending value. The constraint is unchanged — a non-uuid is
 * still rejected before it can reach Postgres and raise SQLSTATE 22P02 (which
 * the error handler maps to a 400 "Invalid identifier format", equally opaque).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReferenceIdFieldName =
  | "primary_muscles"
  | "secondary_muscles"
  | "equipment_required"
  | "accessibility_requirements";

/**
 * Returns an error message naming the first malformed id, or `null` when every
 * supplied array holds only well-formed UUIDs (absent arrays are fine).
 *
 * Reports at most one problem: the client fixes the payload shape as a whole, and
 * echoing every bad value back risks reflecting a large attacker-supplied body
 * into the response.
 */
export function findInvalidReferenceId(
  fields: Partial<Record<ReferenceIdFieldName, readonly string[] | undefined>>,
): string | null {
  for (const [field, values] of Object.entries(fields)) {
    if (!values) continue;
    for (const value of values) {
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        // Truncated: the value is untrusted input and goes into a response body.
        const shown =
          typeof value === "string" ? value.slice(0, 64) : typeof value;
        return `${field} must contain catalogue UUIDs; received "${shown}". Resolve names to ids via GET /exercises/muscle-groups and GET /exercises/equipment.`;
      }
    }
  }
  return null;
}
