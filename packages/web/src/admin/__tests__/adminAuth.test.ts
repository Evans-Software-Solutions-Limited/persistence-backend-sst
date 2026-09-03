import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeJwtPayload,
  loadSession,
  needsRefresh,
  parseCallbackHash,
  saveSession,
  sendMagicLink,
  sessionFromTokens,
} from "../adminAuth";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

describe("adminAuth", () => {
  afterEach(() => {
    saveSession(null);
    vi.unstubAllEnvs();
  });

  it("decodes a JWT payload without verifying and tolerates junk", () => {
    expect(decodeJwtPayload(jwt({ sub: "u1", exp: 5 }))).toEqual({
      sub: "u1",
      exp: 5,
    });
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.b.c")).toBeNull();
  });

  it("derives isAdmin strictly from app_metadata.admin === true", () => {
    expect(
      sessionFromTokens(
        jwt({ exp: 1, email: "b@x.co", app_metadata: { admin: true } }),
        "r",
      )?.isAdmin,
    ).toBe(true);
    expect(
      sessionFromTokens(jwt({ exp: 1, app_metadata: { admin: "true" } }), "r")
        ?.isAdmin,
    ).toBe(false);
    expect(sessionFromTokens(jwt({ exp: 1 }), "r")?.isAdmin).toBe(false);
  });

  it("parses the implicit-flow callback hash, including GoTrue errors", () => {
    const ok = parseCallbackHash(
      `#access_token=${jwt({ exp: 99, email: "b@x.co", app_metadata: { admin: true } })}&refresh_token=rt&type=magiclink`,
    );
    expect(ok.error).toBeNull();
    expect(ok.session?.refreshToken).toBe("rt");
    expect(ok.session?.email).toBe("b@x.co");
    expect(
      parseCallbackHash(
        "#error=access_denied&error_description=Email+link+is+invalid",
      ).error,
    ).toBe("Email link is invalid");
    expect(parseCallbackHash("#type=magiclink").error).toMatch(/missing/);
  });

  it("round-trips the session through sessionStorage", () => {
    expect(loadSession()).toBeNull();
    const s = sessionFromTokens(jwt({ exp: 99 }), "rt")!;
    saveSession(s);
    expect(loadSession()).toEqual(s);
    saveSession(null);
    expect(loadSession()).toBeNull();
  });

  it("flags refresh inside the skew window", () => {
    const s = sessionFromTokens(jwt({ exp: 1000 }), "rt")!;
    expect(needsRefresh(s, 1000 - 120)).toBe(false);
    expect(needsRefresh(s, 1000 - 30)).toBe(true);
    expect(needsRefresh(s, 1001)).toBe(true);
  });

  it("sendMagicLink posts to GoTrue /otp with the anon key and never creates users", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendMagicLink(
      "b@x.co",
      "https://site/admin/callback",
      fetchMock as unknown as typeof fetch,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://proj.supabase.co/auth/v1/otp?redirect_to=https%3A%2F%2Fsite%2Fadmin%2Fcallback",
    );
    expect((init.headers as Record<string, string>).apikey).toBe("anon");
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "b@x.co",
      create_user: false,
    });

    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await expect(
      sendMagicLink(
        "b@x.co",
        "https://site/admin/callback",
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/couldn't send/);
  });

  it("sendMagicLink fails clearly when the site isn't configured", async () => {
    await expect(
      sendMagicLink("b@x.co", "https://site/admin/callback"),
    ).rejects.toThrow(/isn't configured/);
  });
});
