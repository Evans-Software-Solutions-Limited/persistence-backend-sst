/**
 * Grant or revoke the Persistence admin claim on a Supabase auth user.
 *
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   bun run set-admin brad@example.com            # grant
 *   bun run set-admin brad@example.com --revoke   # revoke
 *
 * Writes `app_metadata.admin = true|false`. `app_metadata` is only writable
 * with the service role, and Supabase copies it into every access token, which
 * is what `requireAdmin` (api-utils/auth/supabaseAuth.ts) checks — FOUNDING-
 * OFFER BRIEF D4. The user must sign out and back in (or wait for a token
 * refresh) before the new claim is in their JWT.
 *
 * Deliberately NOT touching `profiles.role`: the `update_subscription_limits`
 * trigger rewrites that column from the subscription tier.
 */

interface AdminUser {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
}

export function parseArgs(argv: string[]): { email: string; revoke: boolean } {
  const revoke = argv.includes("--revoke");
  const email = argv
    .find((a) => !a.startsWith("--"))
    ?.trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("usage: set-admin <email> [--revoke]");
  }
  return { email, revoke };
}

export async function setAdminClaim(
  opts: { email: string; revoke: boolean },
  env: { url: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AdminUser> {
  const base = env.url.replace(/\/$/, "");
  const headers = {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // GoTrue admin: look the user up by email (paged list + client-side match —
  // the admin API has no exact-email filter that is stable across versions).
  let user: AdminUser | undefined;
  for (let page = 1; page <= 20 && !user; page++) {
    const res = await fetchImpl(
      `${base}/auth/v1/admin/users?page=${page}&per_page=200`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`list users failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { users?: AdminUser[] };
    const users = body.users ?? [];
    user = users.find((u) => u.email?.toLowerCase() === opts.email);
    if (users.length < 200) break;
  }
  if (!user) throw new Error(`no auth user with email ${opts.email}`);

  const res = await fetchImpl(`${base}/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      app_metadata: { ...(user.app_metadata ?? {}), admin: !opts.revoke },
    }),
  });
  if (!res.ok) {
    throw new Error(`update user failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as AdminUser;
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  setAdminClaim(opts, { url, serviceRoleKey })
    .then((u) => {
      console.log(
        `${opts.revoke ? "Revoked" : "Granted"} admin for ${u.email} (${u.id}). app_metadata.admin=${String(
          u.app_metadata?.admin,
        )}. They must sign out/in for the claim to reach their token.`,
      );
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
