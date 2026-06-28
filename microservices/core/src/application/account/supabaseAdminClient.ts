import { getEnv } from "@persistence/api-utils/env";

/**
 * Supabase Admin REST client (08-profile-settings § Revised 2026-06-28).
 *
 * Server-only. Uses the project's service-role key to delete the `auth.users`
 * record — something the anon/JWT context cannot do — so the credential can no
 * longer sign in after account deletion (App Store Guideline 5.1.1(v)). Native
 * `fetch` (Lambda Node runtime), no SDK dependency, mirroring the codebase's
 * outbound-HTTP convention (see `revenuecat/revenueCatClient.ts`).
 */

export interface SupabaseAdminConfig {
  /** Project base URL, no trailing slash. */
  url: string;
  serviceRoleKey: string;
}

/**
 * Read + validate the Supabase admin config. Throws (via `getEnv`) when
 * `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is unset — the delete handler
 * calls this BEFORE purging any data so an unconfigured stage fails fast
 * rather than half-deleting an account (requirements 11.7).
 */
export function getSupabaseAdminConfig(): SupabaseAdminConfig {
  return {
    url: getEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/**
 * Delete the Supabase auth user by id via the Admin REST API.
 *
 * Idempotent: a `404` means the user is already gone (e.g. a retry after a
 * partial failure) and is treated as success. Any other non-2xx throws so the
 * caller can surface a 500 and the client can retry.
 */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { url, serviceRoleKey } = getSupabaseAdminConfig();

  const res = await fetch(
    `${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Supabase admin deleteUser failed: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * `deleteAuthUser` with a bounded retry (up to `maxAttempts`, 500ms between).
 * Used by the account-delete handler AFTER the data purge has committed — a
 * transient Supabase Admin 5xx should not block the user from being signed out
 * (the data is already gone). If all attempts fail, the error propagates and
 * the handler logs it for ops cleanup.
 */
export async function deleteAuthUserWithRetry(
  userId: string,
  maxAttempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await deleteAuthUser(userId);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
  throw lastError;
}
