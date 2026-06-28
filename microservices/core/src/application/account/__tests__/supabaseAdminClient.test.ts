/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSupabaseAdminConfig, deleteAuthUser } from "../supabaseAdminClient";

const ORIGINAL = { ...process.env };

describe("getSupabaseAdminConfig", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("reads + trims the URL and returns the service-role key", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
    expect(getSupabaseAdminConfig()).toEqual({
      url: "https://proj.supabase.co",
      serviceRoleKey: "svc-key",
    });
  });

  it("throws when the service-role key is unset", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getSupabaseAdminConfig()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("deleteAuthUser", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
    vi.restoreAllMocks();
  });

  it("calls the Admin REST endpoint with the service-role headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    (globalThis as any).fetch = fetchMock;

    await deleteAuthUser("user-42");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://proj.supabase.co/auth/v1/admin/users/user-42",
      {
        method: "DELETE",
        headers: { apikey: "svc-key", Authorization: "Bearer svc-key" },
      },
    );
  });

  it("treats 404 (already deleted) as success — idempotent retry", async () => {
    (globalThis as any).fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    await expect(deleteAuthUser("gone")).resolves.toBeUndefined();
  });

  it("throws on other non-2xx responses", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    await expect(deleteAuthUser("user-42")).rejects.toThrow(/503/);
  });
});
