import { webcrypto } from "node:crypto";
import * as auth from "../auth";
const tokens = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
};
const user = {
  id: "apple-user",
  email: "private@privaterelay.appleid.com",
  email_confirmed_at: "2026-01-01",
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.com");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public");
  vi.stubGlobal("crypto", webcrypto);
  fetcher = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.endsWith("/user") ? user : tokens)),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function callback(url: string) {
  return new URL(new URL(url).searchParams.get("redirect_to")!);
}
it.each(["apple", "google"] as const)(
  "uses PKCE for %s and a fixed callback",
  async (provider) => {
    const url = new URL(await auth.oauthUrl(provider));
    expect(url.origin).toBe("https://auth.example.com");
    expect(url.searchParams.get("provider")).toBe(provider);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    const cb = callback(url.toString());
    expect(cb.pathname).toBe("/founding/access/callback");
    expect(await auth.completeCallback(`${cb.search}&code=issued`, "")).toEqual(
      { id: user.id, email: user.email },
    );
    const body = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(body.auth_code).toBe("issued");
    expect(body.code_verifier).toHaveLength(43);
    expect(auth.loadSession()?.accessToken).toBe("access");
    await expect(
      auth.completeCallback(`${cb.search}&code=issued`, ""),
    ).rejects.toThrow("could not be verified");
  },
);
it("supports confirmation in a new browser tab and preserves the chosen plan", async () => {
  sessionStorage.setItem(
    "persistence.founding.selected-plan",
    "premium_plus:12",
  );
  await auth.sendSignInLink("buyer@example.com");
  const request = new URL(
    "https://auth.example.com" + fetcher.mock.calls[0]![0].split("/auth/v1")[1],
  );
  const cb = new URL(request.searchParams.get("redirect_to")!);
  sessionStorage.clear(); // a new tab has no original tab's session state
  expect(auth.callbackPlan(cb.search)).toBe("premium_plus:12");
  await expect(
    auth.completeCallback(`${cb.search}&code=issued`, ""),
  ).resolves.toMatchObject({ id: user.id });
});
it("does not overwrite another independent authentication proof", async () => {
  const first = callback(await auth.oauthUrl("apple"));
  const second = callback(await auth.oauthUrl("google"));
  await auth.completeCallback(`${first.search}&code=first`, "");
  await auth.completeCallback(`${second.search}&code=second`, "");
  expect(
    fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
  ).toHaveLength(2);
});
it.each(["?flow=wrong&code=x", "?code=x", "?flow=wrong", ""])(
  "rejects invalid callback %s without calling auth",
  async (search) => {
    await auth.oauthUrl("apple");
    await expect(auth.completeCallback(search, "")).rejects.toThrow(
      "could not be verified",
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("rejects an expired proof and provider cancellation", async () => {
  const cb = callback(await auth.oauthUrl("apple"));
  const key = "persistence.founding.auth-proof." + cb.searchParams.get("flow");
  const proof = JSON.parse(localStorage.getItem(key)!);
  proof.createdAt -= 3600001;
  localStorage.setItem(key, JSON.stringify(proof));
  await expect(
    auth.completeCallback(`${cb.search}&code=x`, ""),
  ).rejects.toThrow("could not be verified");
  await expect(
    auth.completeCallback("?error=access_denied", ""),
  ).rejects.toThrow("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects hash tokens instead of accepting an injected implicit session", async () => {
  await expect(
    auth.completeCallback("", "#access_token=attacker&refresh_token=x"),
  ).rejects.toThrow("could not be verified");
  expect(auth.loadSession()).toBeNull();
});
it("checks the confirmed identity and refuses an account switch before an operation", async () => {
  await auth.signIn("email@example.com", "password");
  await expect(auth.accountSession("other-user")).rejects.toThrow(
    "account changed",
  );
  expect(await auth.accountSession(user.id)).toMatchObject({
    accessToken: "access",
  });
});
it("rejects unverified accounts without saving tokens", async () => {
  fetcher.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/user")
            ? { ...user, email_confirmed_at: null }
            : tokens,
        ),
      ),
  );
  await expect(auth.signIn("email@example.com", "password")).rejects.toThrow(
    "Verify",
  );
  expect(auth.loadSession()).toBeNull();
});
it("handles signup requiring confirmation and a refresh", async () => {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user })));
  expect(await auth.signUp("email@example.com", "password")).toBeNull();
  auth.saveSession({
    accessToken: "expired",
    refreshToken: "refresh",
    expiresAt: 0,
  });
  expect(await auth.currentAccount()).toEqual({
    id: user.id,
    email: user.email,
  });
  expect(
    fetcher.mock.calls.some(([url]) =>
      url.includes("grant_type=refresh_token"),
    ),
  ).toBe(true);
});
it("sanitizes provider failure and clears session on sign out", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "secret" }), { status: 400 }),
  );
  await expect(auth.signIn("email@example.com", "password")).rejects.toThrow(
    "couldn't complete",
  );
  auth.saveSession({
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 9999999999,
  });
  auth.signOut();
  expect(await auth.currentAccount()).toBeNull();
});
it("fails closed when sign-in is not configured", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "");
  await expect(auth.oauthUrl("apple")).rejects.toThrow("unavailable");
  await expect(auth.signIn("a@b.com", "password")).rejects.toThrow(
    "not configured",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("handles malformed stored sessions and missing authentication", async () => {
  sessionStorage.setItem("persistence.founding.session", "not-json");
  expect(auth.loadSession()).toBeNull();
  sessionStorage.setItem(
    "persistence.founding.session",
    JSON.stringify({ accessToken: 1 }),
  );
  expect(auth.loadSession()).toBeNull();
  await expect(auth.activeSession()).rejects.toThrow("Please sign in");
});
it("handles provider throttling and malformed responses without saving tokens", async () => {
  fetcher.mockResolvedValueOnce(new Response("bad", { status: 429 }));
  await expect(auth.signIn("a@b.com", "password")).rejects.toThrow("Too many");
  fetcher.mockResolvedValueOnce(new Response("{}"));
  await expect(auth.signIn("a@b.com", "password")).rejects.toThrow(
    "incomplete",
  );
  expect(auth.loadSession()).toBeNull();
});
it("accepts confirmed signup and explicit token expiry", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ ...tokens, expires_at: 9999999999 })),
  );
  expect(await auth.signUp("a@b.com", "password")).toEqual({
    id: user.id,
    email: user.email,
  });
  expect(auth.loadSession()?.expiresAt).toBe(9999999999);
  expect(
    Object.keys(localStorage).filter((k) =>
      k.startsWith("persistence.founding.auth-proof."),
    ),
  ).toHaveLength(0);
});
it("uses fallback expiry when provider omits expires_in", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ access_token: "access", refresh_token: "refresh" }),
    ),
  );
  await auth.signIn("a@b.com", "password");
  expect(auth.loadSession()!.expiresAt).toBeGreaterThan(
    Date.now() / 1000 + 3500,
  );
});
it("does not overwrite a changed account when refreshing, and coalesces concurrent refreshes", async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  auth.saveSession({
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: 0,
  });
  const first = auth.activeSession();
  const second = auth.activeSession();
  auth.saveSession({
    accessToken: "new",
    refreshToken: "new-refresh",
    expiresAt: 9999999999,
  });
  resolve(new Response(JSON.stringify(tokens)));
  await expect(first).rejects.toThrow("account changed");
  await expect(second).rejects.toThrow("account changed");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(auth.loadSession()?.accessToken).toBe("new");
});
it("cleans malformed and expired proofs without touching unrelated storage", async () => {
  const prefix = "persistence.founding.auth-proof.";
  localStorage.setItem(prefix + "bad", "bad-json");
  localStorage.setItem(prefix + "expired", JSON.stringify({ createdAt: 0 }));
  localStorage.setItem(prefix + "null", "null");
  localStorage.setItem("other-key", "kept");
  await auth.oauthUrl("apple");
  expect(localStorage.getItem(prefix + "bad")).toBeNull();
  expect(localStorage.getItem(prefix + "expired")).toBeNull();
  expect(localStorage.getItem("other-key")).toBe("kept");
});
it("reads only valid callback context and rejects damaged proof", async () => {
  sessionStorage.setItem("persistence.founding.campaign", "meta");
  const cb = callback(await auth.oauthUrl("apple"));
  expect(auth.callbackCampaign(cb.search)).toBe("meta");
  expect(auth.callbackPlan("?flow=unknown")).toBeNull();
  expect(auth.callbackCampaign("?flow=unknown")).toBeNull();
  const key = "persistence.founding.auth-proof." + cb.searchParams.get("flow");
  localStorage.setItem(key, "malformed");
  expect(auth.callbackPlan(cb.search)).toBeNull();
  expect(auth.callbackCampaign(cb.search)).toBeNull();
  await expect(
    auth.completeCallback(`${cb.search}&code=x`, ""),
  ).rejects.toThrow("could not be verified");
});
it.each([
  { verifier: 1 },
  { verifier: "short" },
  { state: "wrong" },
  { createdAt: "bad" },
  { createdAt: Date.now() + 3600000 },
])("rejects a corrupted or future proof %j", async (patch) => {
  const cb = callback(await auth.oauthUrl("apple"));
  const key = "persistence.founding.auth-proof." + cb.searchParams.get("flow");
  localStorage.setItem(
    key,
    JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), ...patch }),
  );
  await expect(
    auth.completeCallback(`${cb.search}&code=x`, ""),
  ).rejects.toThrow("could not be verified");
  expect(fetcher).not.toHaveBeenCalled();
});
