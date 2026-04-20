/**
 * Shared query-param helpers used by repository filters and list handlers.
 *
 * Lives outside the repository module so handler tests that `vi.mock()` the
 * repository don't inadvertently shadow these helpers.
 */

/**
 * Coerce a single-or-array query-param value into a string[]. Elysia's
 * `t.Union([t.String(), t.Array(t.String())])` yields either shape at
 * runtime depending on how many times the key appears in the query
 * string; callers want a uniform array.
 */
export function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
