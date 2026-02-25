import { Elysia } from "elysia";
import { jwtVerify } from "jose";

// Supabase JWT payload shape
export type SupabaseUser = {
  sub: string; // user UUID
  email: string;
  role: string; // 'authenticated' (Supabase default) — app role is in app_metadata
  app_metadata: {
    user_role?: "user" | "personal_trainer" | "physiotherapist" | "admin";
    subscription_tier?: string;
  };
  iat: number;
  exp: number;
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Set it via: sst secret set PersistenceJwtSecret <secret>",
    );
  }
  return secret;
}

// Elysia plugin — attaches `user` to context on all routes that use it
export const supabaseAuth = new Elysia({ name: "SupabaseAuth" }).derive(
  async ({ headers, set }) => {
    const authHeader = headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Missing or invalid Authorization header");
    }
    const token = authHeader.slice(7);
    try {
      // Verify using the JWT secret (HS256 — Supabase default)
      const secret = new TextEncoder().encode(getJwtSecret());
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      });
      return { user: payload as unknown as SupabaseUser };
    } catch {
      set.status = 401;
      throw new Error("Invalid or expired token");
    }
  },
);
