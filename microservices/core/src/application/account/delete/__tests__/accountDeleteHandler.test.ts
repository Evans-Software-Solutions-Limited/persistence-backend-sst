/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-id",
      email: "u@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-id" }),
}));

// Capture call order across the repo + admin so we can assert "purge before
// auth delete" and "no purge when unconfigured". Wrapped in vi.hoisted so the
// hoisted vi.mock factories below can reference them safely.
const { calls, purgeUserData, getSupabaseAdminConfig, deleteAuthUser } =
  vi.hoisted(() => {
    const calls: string[] = [];
    return {
      calls,
      purgeUserData: vi.fn(async () => void calls.push("purge")),
      getSupabaseAdminConfig: vi.fn(() => ({
        url: "https://x.supabase.co",
        serviceRoleKey: "svc",
      })),
      deleteAuthUser: vi.fn(async () => void calls.push("auth-delete")),
    };
  });
vi.mock("../../accountRepository", () => ({
  AccountRepository: vi.fn(() => ({ purgeUserData })),
}));
vi.mock("../../supabaseAdminClient", () => ({
  getSupabaseAdminConfig,
  deleteAuthUser,
}));

import { accountDeleteHandler } from "../accountDeleteHandler";

const authed = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(headers: Record<string, string> = authed) {
  return new Request("http://localhost/account", {
    method: "DELETE",
    headers,
  });
}

describe("accountDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    getSupabaseAdminConfig.mockReturnValue({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
    });
  });

  it("401s when unauthenticated", async () => {
    const res = await accountDeleteHandler.handle(
      del({ "Content-Type": "application/json" }),
    );
    expect(res.status).toBe(401);
    expect(purgeUserData).not.toHaveBeenCalled();
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("purges data then deletes the auth user, returning { deleted: true }", async () => {
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { deleted: true } });
    expect(purgeUserData).toHaveBeenCalledWith("user-id");
    expect(deleteAuthUser).toHaveBeenCalledWith("user-id");
    // Order matters: public-schema purge commits before the auth user goes.
    expect(calls).toEqual(["purge", "auth-delete"]);
  });

  it("fails fast (500) BEFORE any purge when the service-role key is unconfigured", async () => {
    getSupabaseAdminConfig.mockImplementation(() => {
      throw new Error(
        "Missing environment variable for SUPABASE_SERVICE_ROLE_KEY",
      );
    });
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Account deletion is not configured",
    });
    expect(purgeUserData).not.toHaveBeenCalled();
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it("500s when the auth-user delete fails (data already purged; retry is idempotent)", async () => {
    deleteAuthUser.mockRejectedValueOnce(new Error("admin 503"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete account" });
    expect(purgeUserData).toHaveBeenCalledTimes(1);
  });

  it("500s when the data purge fails", async () => {
    purgeUserData.mockRejectedValueOnce(new Error("tx rolled back"));
    const res = await accountDeleteHandler.handle(del());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to delete account" });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
});
