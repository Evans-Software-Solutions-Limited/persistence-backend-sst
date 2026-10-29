import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../auth";

const session = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() / 1000 + 3600,
};
const user = {
  id: "user-1",
  email: "personal@example.com",
  email_confirmed_at: "2026-09-14T00:00:00Z",
};
const token = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
};
let fetcher: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  sessionStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.com/");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-key");
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("customer authentication", () => {
  it("keeps customer and admin sessions separate and rejects corrupt storage", () => {
    sessionStorage.setItem(
      "persistence.admin.session",
      JSON.stringify(session),
    );
    expect(auth.loadSession()).toBeNull();
    auth.saveSession(session);
    expect(auth.loadSession()).toEqual(session);
    auth.signOut();
    expect(auth.loadSession()).toBeNull();
    expect(sessionStorage.getItem("persistence.admin.session")).not.toBeNull();
    sessionStorage.setItem("persistence.redemption.session", "invalid");
    expect(auth.loadSession()).toBeNull();
    sessionStorage.setItem(
      "persistence.redemption.session",
      JSON.stringify({ accessToken: 1 }),
    );
    expect(auth.loadSession()).toBeNull();
  });
  it("validates the signed-in user with the provider before retaining tokens", async () => {
    fetcher
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json(user));
    expect(await auth.signIn(user.email, "password")).toEqual({
      id: user.id,
      email: user.email,
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://auth.example.com/auth/v1/token?grant_type=password",
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      email: user.email,
      password: "password",
    });
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer access",
    );
    expect(auth.loadSession()?.accessToken).toBe("access");
  });
  it("refuses an unverified account and never persists its session", async () => {
    fetcher
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json({ ...user, email_confirmed_at: null }));
    await expect(auth.signIn(user.email, "password")).rejects.toThrow("Verify");
    expect(auth.loadSession()).toBeNull();
  });
  it("uses a dedicated signup callback and waits for normal email verification", async () => {
    fetcher.mockResolvedValueOnce(json({ user }));
    expect(await auth.signUp(user.email, "new-password")).toBeNull();
    expect(fetcher.mock.calls[0][0]).toContain(
      `/signup?redirect_to=${encodeURIComponent(window.location.origin + "/redeem/callback")}`,
    );
    expect(auth.loadSession()).toBeNull();
  });
  it("accepts already-verified signup sessions without modifying any account", async () => {
    fetcher
      .mockResolvedValueOnce(json({ ...token, expires_at: 2000000000 }))
      .mockResolvedValueOnce(json(user));
    expect(await auth.signUp(user.email, "new-password")).toEqual({
      id: user.id,
      email: user.email,
    });
    expect(auth.loadSession()?.expiresAt).toBe(2000000000);
    expect(fetcher.mock.calls.every(([url]) => !url.includes("/admin/"))).toBe(
      true,
    );
  });
  it("email sign-in explicitly forbids account creation", async () => {
    fetcher.mockResolvedValue(json({}));
    await auth.sendSignInLink(user.email);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      email: user.email,
      create_user: false,
    });
    expect(fetcher.mock.calls[0][0]).toContain("%2Fredeem%2Fcallback");
  });
  it("verifies callbacks and rejects missing/error payloads without storing them", async () => {
    await expect(auth.completeCallback("#error=expired")).rejects.toThrow(
      "expired",
    );
    await expect(auth.completeCallback("#access_token=a")).rejects.toThrow(
      "missing",
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(json(user));
    await auth.completeCallback(
      "#access_token=access&refresh_token=refresh&expires_in=bad",
    );
    expect(auth.loadSession()?.accessToken).toBe("access");
  });
  it("refreshes once for concurrent callers, then verifies the current identity", async () => {
    auth.saveSession({ ...session, expiresAt: 0 });
    fetcher
      .mockResolvedValueOnce(json({ ...token, access_token: "renewed" }))
      .mockResolvedValueOnce(json(user));
    const [a, b] = await Promise.all([
      auth.activeSession(),
      auth.activeSession(),
    ]);
    expect(a.accessToken).toBe("renewed");
    expect(b).toEqual(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await auth.currentAccount()).toEqual({
      id: user.id,
      email: user.email,
    });
  });
  it("does not resurrect a session changed while refresh was in flight", async () => {
    auth.saveSession({ ...session, expiresAt: 0 });
    let finish!: (response: Response) => void;
    fetcher.mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const pending = auth.activeSession();
    auth.signOut();
    finish(json(token));
    await expect(pending).rejects.toThrow("account changed");
    expect(auth.loadSession()).toBeNull();
  });
  it("handles no account, incomplete responses, missing config and provider failures", async () => {
    expect(await auth.currentAccount()).toBeNull();
    await expect(auth.activeSession()).rejects.toThrow("Please sign in");
    fetcher.mockResolvedValueOnce(json({}));
    await expect(auth.signIn(user.email, "x")).rejects.toThrow("incomplete");
    fetcher.mockResolvedValueOnce(json({ error: "private data" }, 429));
    await expect(auth.signIn(user.email, "x")).rejects.toThrow("Too many");
    fetcher.mockResolvedValueOnce(new Response("not JSON", { status: 400 }));
    await expect(auth.signIn(user.email, "x")).rejects.toThrow(
      "Check your details",
    );
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(auth.authConfig()).toBeNull();
    await expect(auth.signIn(user.email, "x")).rejects.toThrow(
      "not configured",
    );
  });
});
