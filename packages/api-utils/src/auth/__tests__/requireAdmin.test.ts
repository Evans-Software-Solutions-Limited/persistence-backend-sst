import { describe, expect, it } from "vitest";
import { isAdmin, requireAdmin, type SupabaseUser } from "../supabaseAuth";

const base: SupabaseUser = {
  sub: "user-1",
  email: "a@b.co",
  email_verified: true,
  iat: 0,
  exp: 9999999999,
};

function ctx(user: SupabaseUser | null) {
  return { user, set: { status: 200 as number | string } };
}

describe("isAdmin", () => {
  it("is true only for a strict boolean app_metadata.admin", () => {
    expect(isAdmin({ ...base, app_metadata: { admin: true } })).toBe(true);
    expect(
      isAdmin({
        ...base,
        app_metadata: { admin: "true" as unknown as boolean },
      }),
    ).toBe(false);
    expect(
      isAdmin({ ...base, app_metadata: { admin: 1 as unknown as boolean } }),
    ).toBe(false);
    expect(isAdmin({ ...base, app_metadata: {} })).toBe(false);
    expect(isAdmin(base)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("401s without a user", () => {
    const c = ctx(null);
    expect(requireAdmin(c)).toEqual({ message: "Unauthorized" });
    expect(c.set.status).toBe(401);
  });

  it("403s a signed-in non-admin with a constant body", () => {
    const c = ctx(base);
    expect(requireAdmin(c)).toEqual({ message: "Forbidden" });
    expect(c.set.status).toBe(403);
  });

  it("passes an admin through (returns undefined, status untouched)", () => {
    const c = ctx({ ...base, app_metadata: { admin: true } });
    expect(requireAdmin(c)).toBeUndefined();
    expect(c.set.status).toBe(200);
  });
});
