import { afterEach, describe, expect, it, vi } from "vitest";
import {
  main,
  validateAdminConfig,
  verifyAdminAccess,
} from "../validate-supabase-admin";
const ref = "opcvjypsoivaxerahbal";
const claims = { ref, role: "service_role", exp: 4_000_000_000 };
const token = (value: unknown = claims) =>
  `e30.${Buffer.from(JSON.stringify(value)).toString("base64url")}.signature`;
const env = (key = token()) => ({
  SUPABASE_PROJECT_REF: ref,
  SUPABASE_SERVICE_ROLE_KEY: key,
});
afterEach(() => vi.restoreAllMocks());
describe("deployment admin credential gate", () => {
  it("accepts the production service role for the production project", () => {
    expect(validateAdminConfig("production", env())).toEqual({
      url: `https://${ref}.supabase.co`,
      key: token(),
    });
  });
  it.each([
    { ...claims, ref: "dfeyebgdktfteqlacmru" },
    { ...claims, role: "anon" },
    { ...claims, exp: 1 },
    { ...claims, exp: "4000000000" },
    { role: "service_role" },
  ])(
    "rejects wrong project, role and expiry before a network request: %j",
    (value) => {
      expect(() =>
        validateAdminConfig("production", env(token(value))),
      ).toThrow(/project, role, or expiry/);
    },
  );
  it.each([
    "",
    " ",
    "sb_publishable_public",
    "a.b.c",
    "a.b",
    "a.b.c.d",
    "a.!.c",
    token(null),
  ])("rejects malformed or missing credentials", (key) => {
    expect(() => validateAdminConfig("production", env(key))).toThrow();
  });
  it("rejects the wrong stage and configured project", () => {
    expect(() => validateAdminConfig("prod", env())).toThrow(/Expected/);
    expect(() => validateAdminConfig("staging", env())).toThrow(
      /selected stage/,
    );
    expect(() => validateAdminConfig("production", {})).toThrow(
      /selected stage/,
    );
  });
  it("permits opaque server keys only with a subsequent live admin check", () => {
    expect(
      validateAdminConfig("production", env("sb_secret_example")).key,
    ).toBe("sb_secret_example");
  });
  it("uses a bounded, read-only admin request and disposes of its response", async () => {
    const response = new Response('{"users":[]}');
    const cancel = vi.spyOn(response.body!, "cancel");
    const request = vi.fn().mockResolvedValue(response);
    await verifyAdminAccess(validateAdminConfig("production", env()), request);
    expect(request).toHaveBeenCalledWith(
      `https://${ref}.supabase.co/auth/v1/admin/users?page=1&per_page=1`,
      expect.objectContaining({
        headers: { apikey: token(), Authorization: `Bearer ${token()}` },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 500, 302])(
    "blocks deployment on HTTP %s without exposing provider content",
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(new Response("private provider detail", { status }));
      await expect(
        verifyAdminAccess(
          { url: "https://example.com", key: "secret" },
          request,
        ),
      ).rejects.toThrow(`(HTTP ${status})`);
    },
  );
  it("sanitizes network exceptions which might contain credentials", async () => {
    await expect(
      verifyAdminAccess(
        { url: "https://example.com", key: "secret" },
        vi.fn().mockRejectedValue(new Error("secret")),
      ),
    ).rejects.toThrow("could not reach the selected project");
  });
  it("requires exactly one stage argument", async () => {
    await expect(main([], env())).rejects.toThrow(/Usage/);
    await expect(main(["production", "extra"], env())).rejects.toThrow(/Usage/);
  });
  it("runs the live gate before reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["production"], env());
      expect(log).toHaveBeenCalledWith(
        "Supabase admin credential verified for the selected stage.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
