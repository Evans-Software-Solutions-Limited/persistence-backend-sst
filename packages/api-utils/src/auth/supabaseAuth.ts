import { createRemoteJWKSet, jwtVerify } from "jose";

// Supabase JWT payload shape
export type SupabaseUser = {
  sub: string; // user UUID
  email: string;
  email_verified: boolean;
  iat: number;
  exp: number;
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
  try {
    const { payload } = await jwtVerify(token, getJwks());
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
