/**
 * Auth deep-link token parser.
 *
 * A Supabase auth redirect (email confirmation, password recovery, or the
 * OAuth implicit flow) hands the session back in the URL — normally in the
 * fragment (`#access_token=…&refresh_token=…&type=signup`), occasionally in
 * the query string (`?access_token=…`). Failed/expired links carry
 * `#error=…&error_description=…` and no tokens.
 *
 * The `auth/callback` deep-link screen reads the raw launch URL (via
 * `expo-linking`) and runs it through here to decide whether to establish a
 * session or bounce to sign-in. Kept as a pure function (no expo/RN imports)
 * so it's unit-testable in isolation. Mirrors the adapter's private
 * `extractOAuthParams` (fragment-first, query fallback) and additionally
 * surfaces `type` and any error, so the two auth entry points agree on how a
 * redirect URL is read.
 */
export type AuthCallbackParams = {
  accessToken: string | null;
  refreshToken: string | null;
  /** Supabase link type: `signup`, `recovery`, `magiclink`, `invite`, … */
  type: string | null;
  /** Error code from a failed link (e.g. `access_denied`), if present. */
  error: string | null;
  /** Human-readable error detail from a failed link, if present. */
  errorDescription: string | null;
};

const EMPTY: AuthCallbackParams = {
  accessToken: null,
  refreshToken: null,
  type: null,
  error: null,
  errorDescription: null,
};

/**
 * Pull the token/error params out of an auth-callback URL. Reads the fragment
 * first (Supabase's default for these flows) and falls back to the query
 * string. Returns all-null for a null/empty/paramless URL rather than throwing.
 */
export function parseAuthCallbackUrl(
  url: string | null | undefined,
): AuthCallbackParams {
  if (!url) return EMPTY;

  const fragment = sliceAfter(url, "#");
  const query = sliceAfter(url, "?", "#");

  // Fragment wins (implicit flow); query is the fallback. Merge so a value
  // present in either is found, without one clobbering the other with null.
  const fromFragment = new URLSearchParams(fragment);
  const fromQuery = new URLSearchParams(query);
  const get = (key: string): string | null =>
    fromFragment.get(key) ?? fromQuery.get(key);

  return {
    accessToken: get("access_token"),
    refreshToken: get("refresh_token"),
    type: get("type"),
    error: get("error"),
    errorDescription: get("error_description"),
  };
}

/**
 * Return the substring after the first `start` delimiter, stopping before an
 * optional `end` delimiter. `sliceAfter("a?b#c", "?", "#")` → `"b"`;
 * `sliceAfter("a?b#c", "#")` → `"c"`; no delimiter → `""`.
 */
function sliceAfter(input: string, start: string, end?: string): string {
  const startIndex = input.indexOf(start);
  if (startIndex === -1) return "";
  const rest = input.slice(startIndex + 1);
  if (!end) return rest;
  const endIndex = rest.indexOf(end);
  return endIndex === -1 ? rest : rest.slice(0, endIndex);
}
