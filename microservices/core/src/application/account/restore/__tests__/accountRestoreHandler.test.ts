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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-id" }),
}));

const { restore } = vi.hoisted(() => ({
  restore: vi.fn(async (): Promise<"restored" | "not_deleted"> => "restored"),
}));

vi.mock("../../accountRepository", () => ({
  AccountRepository: vi.fn(() => ({ restore })),
}));

import { accountRestoreHandler } from "../accountRestoreHandler";

const authed = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function post(headers: Record<string, string> = authed) {
  return new Request("http://localhost/account/restore", {
    method: "POST",
    headers,
  });
}

describe("accountRestoreHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restore.mockResolvedValue("restored");
  });

  it("401s when unauthenticated", async () => {
    const res = await accountRestoreHandler.handle(
      post({ "Content-Type": "application/json" }),
    );
    expect(res.status).toBe(401);
    expect(restore).not.toHaveBeenCalled();
  });

  it("clears the soft-delete and returns restored: true for a currently-deleted account", async () => {
    restore.mockResolvedValue("restored");
    const res = await accountRestoreHandler.handle(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { restored: true } });
    expect(restore).toHaveBeenCalledWith("user-id");
  });

  it("is a 200 no-op (restored: false) when the account was never soft-deleted", async () => {
    restore.mockResolvedValue("not_deleted");
    const res = await accountRestoreHandler.handle(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { restored: false } });
  });

  it("scopes the restore to the authenticated caller only (never a body-supplied id)", async () => {
    await accountRestoreHandler.handle(post());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith("user-id");
  });
});
