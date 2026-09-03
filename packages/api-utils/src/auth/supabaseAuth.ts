import { createRemoteJWKSet, jwtVerify } from "jose";

// Supabase JWT payload shape
export type SupabaseUser = {
  sub: string; // user UUID
  email: string;
  email_verified: boolean;
  iat: number;
  exp: number;
  /**
   * Supabase copies `auth.users.raw_app_meta_data` into the access token as
   * `app_metadata`. It is writable ONLY through the service role (never by the
   * user), which is what makes it a trustworthy place for the admin flag —
   * unlike `profiles.role`, which the `update_subscription_limits` trigger
   * rewrites from the subscription tier (FOUNDING-OFFER BRIEF D4).
   */
  app_metadata?: { admin?: boolean; [key: string]: unknown };
};

// Cached per Lambda warm instance — avoids re-fetching on every request
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("SUPABASE_URL environment variable is not set");
    }
    _jwks = createRemoteJWKSet(
      new URL(
        `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`,
      ),
    );
  }
  return _jwks;
}

/**
 * Verify a Supabase JWT from the Authorization header.
 * Returns the user payload or null if missing/invalid.
 */
export async function getAuthUser(
  authHeader: string | undefined,
): Promise<SupabaseUser | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  // getJwks() is intentionally outside the try-catch: a missing/invalid
  // SUPABASE_URL is a configuration error that should surface as a 500,
  // not be silently swallowed and returned as a 401.
  const jwks = getJwks();
  try {
    const { payload } = await jwtVerify(token, jwks);
    return payload as unknown as SupabaseUser;
  } catch (err) {
    console.error("[supabaseAuth] JWT verification failed:", err);
    return null;
  }
}

/**
 * onBeforeHandle callback — wire this directly on each protected handler.
 * Returning a value from onBeforeHandle stops the Elysia pipeline.
 *
 * Usage:
 *   .derive(async ({ headers }) => ({ user: await getAuthUser(headers.authorization) }))
 *   .onBeforeHandle(requireAuth)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireAuth(ctx: any) {
  if (!ctx.user) {
    ctx.set.status = 401;
    return { message: "Unauthorized" };
  }
}

/**
 * Typed helper to read the user from handler context after requireAuth has run.
 * Safe to call because requireAuth guarantees user is non-null.
 */
export function getUser(ctx: { user: SupabaseUser | null }): SupabaseUser {
  return ctx.user as SupabaseUser;
}

/**
 * Is this verified user a Persistence administrator? Reads ONLY the JWT's
 * `app_metadata.admin` claim (set via `bun run set-admin <email>` in
 * `scripts/`). Strict `=== true` — a string "true" or 1 does not count.
 */
export function isAdmin(user: SupabaseUser | null | undefined): boolean {
  return user?.app_metadata?.admin === true;
}

/**
 * onBeforeHandle guard for `/admin/*` routes. 401 without a user, 403 without
 * the admin claim. The 403 body is constant and says nothing about *why* —
 * never leak whether the account exists or what role it holds.
 *
 * Usage (same shape as `requireAuth`):
 *   .derive(async ({ headers }) => ({ user: await getAuthUser(headers.authorization) }))
 *   .onBeforeHandle(requireAdmin)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireAdmin(ctx: any) {
  if (!ctx.user) {
    ctx.set.status = 401;
    return { message: "Unauthorized" };
  }
  if (!isAdmin(ctx.user as SupabaseUser)) {
    ctx.set.status = 403;
    return { message: "Forbidden" };
  }
}
