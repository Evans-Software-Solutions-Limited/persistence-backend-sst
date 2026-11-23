import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoachApiError,
  coachApi,
  coachFetch,
  isCoachApiError,
  newIdempotencyKey,
} from "../api/coachApi";
import {
  COACH_SESSION_KEY,
  endSession,
  getAccessToken,
  loadSession,
  needsRefresh,
  onSignedOut,
  parseCallbackHash,
  refreshSession,
  saveSession,
  sendMagicLink,
  sessionFromTokens,
  signOut,
} from "../api/coachAuth";

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;

function res(status: number, body: unknown) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.test/");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("VITE_CORE_API_URL", "https://api.test/");
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("coach session", () => {
  it("reads the token's expiry and email", () => {
    const s = sessionFromTokens(jwt({ exp: 100, email: "e@x.co" }), "r");
    expect(s).toEqual({
      accessToken: expect.any(String),
      refreshToken: "r",
      expiresAt: 100,
      email: "e@x.co",
    });
    expect(sessionFromTokens("not-a-jwt", null)).toBeNull();
    expect(sessionFromTokens(jwt({}), null)).toMatchObject({
      expiresAt: 0,
      email: null,
    });
  });

  it("parses the magic-link callback", () => {
    expect(parseCallbackHash("#error_description=Link%20expired").error).toBe(
      "Link expired",
    );
    expect(parseCallbackHash("#").error).toMatch(/missing/);
    expect(parseCallbackHash("#access_token=bad").error).toMatch(
      /couldn't be read/,
    );
    const ok = parseCallbackHash(
      `#access_token=${jwt({ exp: 5 })}&refresh_token=r`,
    );
    expect(ok.session?.refreshToken).toBe("r");
  });

  it("keeps the session in localStorage", () => {
    expect(loadSession()).toBeNull();
    saveSession({
      accessToken: "a",
      refreshToken: null,
      expiresAt: 1,
      email: null,
    });
    expect(loadSession()?.accessToken).toBe("a");
    localStorage.setItem(COACH_SESSION_KEY, "{bad");
    expect(loadSession()).toBeNull();
    localStorage.setItem(COACH_SESSION_KEY, JSON.stringify({ nope: 1 }));
    expect(loadSession()).toBeNull();
    saveSession(null);
    expect(localStorage.getItem(COACH_SESSION_KEY)).toBeNull();
    expect(
      needsRefresh(
        { accessToken: "a", refreshToken: null, expiresAt: 100, email: null },
        50,
      ),
    ).toBe(true);
  });

  it("sends a magic link only to existing accounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, {}));
    await sendMagicLink("e@x.co", "https://site/coach/callback", fetchMock);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://auth.test/auth/v1/otp?redirect_to=https%3A%2F%2Fsite%2Fcoach%2Fcallback",
    );
    expect(JSON.parse(init.body)).toMatchObject({
      email: "e@x.co",
      create_user: false,
    });
    await expect(
      sendMagicLink("e", "r", vi.fn().mockResolvedValue(res(422, {}))),
    ).rejects.toThrow("We couldn't send a link to that address");
    await expect(
      sendMagicLink("e", "r", vi.fn().mockResolvedValue(res(500, {}))),
    ).rejects.toThrow("Sign-in failed (500)");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    await expect(sendMagicLink("e", "r", fetchMock)).rejects.toThrow(
      /isn't set up/,
    );
  });

  it("refreshes near expiry, and keeps the token while offline", async () => {
    const old = {
      accessToken: jwt({ exp: 1 }),
      refreshToken: "r1",
      expiresAt: 1,
      email: null,
    };
    const fresh = jwt({ exp: future() });
    const ok = vi.fn(async () =>
      res(200, { access_token: fresh, refresh_token: "r2" }),
    );
    const refreshed = await refreshSession(old, ok);
    expect(refreshed.kind === "ok" && refreshed.session.refreshToken).toBe(
      "r2",
    );
    const answer = (status: number) =>
      vi.fn().mockResolvedValue(res(status, {}));
    for (const status of [400, 401, 403]) {
      expect(await refreshSession(old, answer(status))).toEqual({
        kind: "rejected",
      });
    }
    for (const status of [429, 500, 503]) {
      expect(await refreshSession(old, answer(status))).toEqual({
        kind: "unavailable",
      });
    }
    expect(await refreshSession(old, answer(200))).toEqual({
      kind: "unavailable",
    });
    expect(
      await refreshSession(
        old,
        vi.fn().mockRejectedValue(new TypeError("net")),
      ),
    ).toEqual({ kind: "unavailable" });
    expect(await refreshSession({ ...old, refreshToken: null }, ok)).toEqual({
      kind: "rejected",
    });
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(await refreshSession(old, ok)).toEqual({ kind: "unavailable" });
    vi.stubEnv("VITE_SUPABASE_URL", "https://auth.test/");

    expect(await getAccessToken(ok, () => true)).toBeNull();
    saveSession(old);
    expect(await getAccessToken(ok, () => false)).toBe(old.accessToken);
    expect(await getAccessToken(ok, () => true)).toBe(fresh);
    expect(await getAccessToken(ok, () => true)).toBe(fresh);
    saveSession(old);
    expect(
      await getAccessToken(vi.fn().mockResolvedValue(res(401, {})), () => true),
    ).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it("keeps the session when the refresh can't get an answer (review #549)", async () => {
    const old = {
      accessToken: jwt({ exp: 1 }),
      refreshToken: "r1",
      expiresAt: 1,
      email: null,
    };
    const outages = [
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      vi.fn().mockResolvedValue(res(503, {})),
      vi.fn().mockResolvedValue(res(429, {})),
    ];
    for (const fetchImpl of outages) {
      saveSession(old);
      expect(await getAccessToken(fetchImpl, () => true)).toBe(old.accessToken);
      expect(loadSession()?.refreshToken).toBe("r1");
    }
  });

  it("tells listeners when the session ends", async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    saveSession({
      accessToken: jwt({ exp: 1 }),
      refreshToken: "r1",
      expiresAt: 1,
      email: null,
    });
    await getAccessToken(
      vi.fn().mockResolvedValue(res(400, { error: "invalid_grant" })),
      () => true,
    );
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    endSession();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("signs out locally even if the server call fails", async () => {
    await signOut(vi.fn());
    saveSession({
      accessToken: "a",
      refreshToken: null,
      expiresAt: future(),
      email: null,
    });
    const fail = vi.fn().mockRejectedValue(new Error("down"));
    await signOut(fail);
    expect(loadSession()).toBeNull();
    expect(fail).toHaveBeenCalledWith(
      "https://auth.test/auth/v1/logout",
      expect.anything(),
    );
  });
});

describe("coach API client", () => {
  beforeEach(() => {
    saveSession({
      accessToken: jwt({ exp: future() }),
      refreshToken: null,
      expiresAt: future(),
      email: null,
    });
  });

  it("keeps the server's error code and marks network failures offline", async () => {
    await expect(
      coachFetch(
        "/x",
        {},
        vi
          .fn()
          .mockResolvedValue(
            res(409, { code: "revision_conflict", message: "m" }),
          ),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "revision_conflict",
      message: "m",
    });
    await expect(
      coachFetch(
        "/x",
        {},
        vi.fn().mockResolvedValue(res(403, { error: "manual" })),
      ),
    ).rejects.toMatchObject({
      code: "manual",
      message: "Request failed (403)",
    });
    await expect(
      coachFetch(
        "/x",
        {},
        vi.fn().mockResolvedValue(new Response("<html>", { status: 500 })),
      ),
    ).rejects.toMatchObject({
      body: null,
    });
    const offline = await coachFetch(
      "/x",
      {},
      vi.fn().mockRejectedValue(new TypeError("Failed")),
    ).catch((e) => e);
    expect(isCoachApiError(offline) && offline.offline).toBe(true);
    expect((offline as CoachApiError).message).toBe("You're offline");
    expect(new CoachApiError(400, null).code).toBeNull();
    expect(isCoachApiError(new Error())).toBe(false);
  });

  it("signs out on 401 and refuses without a session", async () => {
    await expect(
      coachFetch("/x", {}, vi.fn().mockResolvedValue(res(401, {}))),
    ).rejects.toMatchObject({ status: 401 });
    expect(loadSession()).toBeNull();
    await expect(coachFetch("/x")).rejects.toMatchObject({
      status: 401,
      message: "Signed out",
    });
  });

  describe("a 401 from the API (review #549, sweep 2)", () => {
    const withRefresh = () =>
      saveSession({
        accessToken: jwt({ exp: future() }),
        refreshToken: "r1",
        expiresAt: future(),
        email: null,
      });
    /** API answers in turn; GoTrue's token endpoint answers `auth`. */
    const server = (api: Response[], auth: () => Promise<Response>) =>
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        void init;
        return String(url).includes("/auth/v1/token") ? auth() : api.shift()!;
      });

    it("refreshes and retries once with the new token", async () => {
      withRefresh();
      const fresh = jwt({ exp: future() + 60 });
      const f = server([res(401, {}), res(200, { data: "ok" })], async () =>
        res(200, { access_token: fresh, refresh_token: "r2" }),
      );
      expect(await coachFetch("/x", {}, f)).toEqual({ data: "ok" });
      const apiCalls = f.mock.calls.filter(([u]) =>
        String(u).startsWith("https://api.test"),
      );
      expect(apiCalls).toHaveLength(2);
      expect(apiCalls[1][1]?.headers).toMatchObject({
        Authorization: `Bearer ${fresh}`,
      });
      expect(loadSession()?.refreshToken).toBe("r2");
    });

    it("keeps the session when Supabase Auth can't answer", async () => {
      withRefresh();
      const listener = vi.fn();
      const stop = onSignedOut(listener);
      for (const auth of [
        async () => res(503, {}),
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ]) {
        await expect(
          coachFetch("/x", {}, server([res(401, {})], auth)),
        ).rejects.toMatchObject({ status: 503, code: "auth_unavailable" });
        expect(loadSession()?.refreshToken).toBe("r1");
      }
      expect(listener).not.toHaveBeenCalled();
      stop();
    });

    it("signs out only when GoTrue refuses the refresh", async () => {
      withRefresh();
      await expect(
        coachFetch(
          "/x",
          {},
          server([res(401, {})], async () => res(400, {})),
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(loadSession()).toBeNull();
    });

    it("a refresh that finishes after Sign out doesn't write the session back (sweep 3)", async () => {
      withRefresh();
      // GoTrue answers the refresh only after the coach has signed out.
      const lateAuth = async () => {
        saveSession(null);
        return res(200, {
          access_token: jwt({ exp: future() }),
          refresh_token: "r2",
        });
      };
      await expect(
        coachFetch("/x", {}, server([res(401, {})], lateAuth)),
      ).rejects.toMatchObject({ status: 401, message: "Signed out" });
      expect(loadSession()).toBeNull();

      saveSession({
        accessToken: jwt({ exp: 1 }),
        refreshToken: "r1",
        expiresAt: 1,
        email: null,
      });
      expect(await getAccessToken(vi.fn(lateAuth), () => true)).toBeNull();
      expect(loadSession()).toBeNull();
    });

    it("parallel refreshes share one request and nobody is signed out (sweep 5)", async () => {
      saveSession({
        accessToken: jwt({ exp: 1 }),
        refreshToken: "r1",
        expiresAt: 1,
        email: null,
      });
      const listener = vi.fn();
      const stop = onSignedOut(listener);
      const fresh = jwt({ exp: future() });
      const gotrue = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return res(200, { access_token: fresh, refresh_token: "r2" });
      });
      const tokens = await Promise.all([
        getAccessToken(gotrue, () => true),
        getAccessToken(gotrue, () => true),
        getAccessToken(gotrue, () => true),
      ]);
      expect(tokens).toEqual([fresh, fresh, fresh]);
      expect(gotrue).toHaveBeenCalledTimes(1);
      expect(loadSession()?.refreshToken).toBe("r2");
      expect(listener).not.toHaveBeenCalled();
      stop();
    });

    it("two requests refused at once both retry with the refreshed token (sweep 5)", async () => {
      withRefresh();
      const fresh = jwt({ exp: future() + 60 });
      let calls = 0;
      const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("/auth/v1/token")) {
          await new Promise((r) => setTimeout(r, 5));
          return res(200, { access_token: fresh, refresh_token: "r2" });
        }
        const bearer = (init?.headers as Record<string, string>).Authorization;
        calls += 1;
        return bearer === `Bearer ${fresh}`
          ? res(200, { data: calls })
          : res(401, {});
      });
      const results = await Promise.all([
        coachFetch("/a", {}, f),
        coachFetch("/b", {}, f),
      ]);
      expect(results).toHaveLength(2);
      expect(
        f.mock.calls.filter(([u]) => String(u).includes("/auth/v1/token")),
      ).toHaveLength(1);
      expect(loadSession()?.refreshToken).toBe("r2");
    });

    it("another tab refreshed first: its session is used, not a sign-out (sweep 5)", async () => {
      withRefresh();
      const listener = vi.fn();
      const stop = onSignedOut(listener);
      const otherTab = {
        accessToken: jwt({ exp: future() + 120 }),
        refreshToken: "r9",
        expiresAt: future() + 120,
        email: null,
      };
      // GoTrue refuses r1 because the other tab already rotated it.
      const f = server([res(401, {}), res(200, { data: "ok" })], async () => {
        saveSession(otherTab);
        return res(400, { error: "invalid_grant" });
      });
      expect(await coachFetch("/x", {}, f)).toEqual({ data: "ok" });
      expect(loadSession()?.refreshToken).toBe("r9");
      expect(listener).not.toHaveBeenCalled();
      stop();
    });

    it("a 401 on a token GoTrue just issued keeps the session (sweep 3)", async () => {
      withRefresh();
      const listener = vi.fn();
      const stop = onSignedOut(listener);
      await expect(
        coachFetch(
          "/x",
          {},
          server([res(401, {}), res(401, {})], async () =>
            res(200, {
              access_token: jwt({ exp: future() }),
              refresh_token: "r2",
            }),
          ),
        ),
      ).rejects.toMatchObject({ status: 503, code: "auth_unavailable" });
      expect(loadSession()?.refreshToken).toBe("r2");
      expect(listener).not.toHaveBeenCalled();
      stop();
    });
  });

  it("sends the JWT and parses the body", async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: 1 }));
    expect(await coachFetch("/thing", { method: "POST" }, f)).toEqual({
      data: 1,
    });
    expect(f.mock.calls[0][0]).toBe("https://api.test/thing");
    expect(f.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /);
    expect(
      await coachFetch(
        "/none",
        {},
        vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
      ),
    ).toBeNull();
  });

  it("calls each route with the right method, path and body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/trainers/me/forms"))
          return res(200, { data: { forms: ["f"] } });
        if (url.endsWith("/form-schedules"))
          return res(200, { data: { schedules: ["s"] } });
        if (url.endsWith("/meal-plans"))
          return res(200, { data: { plans: ["p"] } });
        if (init?.method === "DELETE")
          return new Response(null, { status: 204 });
        return res(200, { data: "ok", invited: [] });
      }),
    );
    const id = "p/1";
    expect(await coachApi.profile()).toBe("ok");
    expect(await coachApi.roster()).toEqual({ data: "ok", invited: [] });
    await coachApi.createProfile({ displayName: "L" }, "k1");
    await coachApi.profileDetail(id);
    await coachApi.patchProfile(id, { goal: "g" }, 2);
    await coachApi.replaceSection(
      id,
      "meal_plan",
      [{ id: "x", refId: "r", config: {}, sortOrder: 0, materialisedAt: null }],
      3,
    );
    await coachApi.copyFrom(id, { sourceClientId: "c" });
    await coachApi.preview(id);
    await coachApi.issueInvite(id, "k2");
    await coachApi.cancelInvite(id);
    await coachApi.deleteProfile(id);
    expect(await coachApi.forms()).toEqual(["f"]);
    expect(await coachApi.formSchedules()).toEqual(["s"]);
    expect(await coachApi.mealPlans()).toEqual(["p"]);
    await coachApi.settings("c1");
    await coachApi.patchSettings("c1", { trackCalories: true }, 4);
    await coachApi.endCoaching("c1");
    await coachApi.declaration();
    await coachApi.acceptDeclaration("v1", "h", "k3");
    expect(newIdempotencyKey()).toMatch(/.{8,}/);

    const seen = calls.map(
      (c) =>
        `${c.init?.method ?? "GET"} ${c.url.replace("https://api.test", "")}`,
    );
    expect(seen).toEqual([
      "GET /profile",
      "GET /trainers/me/clients",
      "POST /trainers/me/client-profiles",
      "GET /trainers/me/client-profiles/p%2F1",
      "PATCH /trainers/me/client-profiles/p%2F1",
      "PUT /trainers/me/client-profiles/p%2F1/setup/meal_plan",
      "POST /trainers/me/client-profiles/p%2F1/setup/copy-from",
      "GET /trainers/me/client-profiles/p%2F1/preview",
      "POST /trainers/me/client-profiles/p%2F1/invite",
      "DELETE /trainers/me/client-profiles/p%2F1/invite",
      "DELETE /trainers/me/client-profiles/p%2F1",
      "GET /trainers/me/forms",
      "GET /trainers/me/form-schedules",
      "GET /trainers/me/meal-plans",
      "GET /trainers/me/clients/c1/settings",
      "PATCH /trainers/me/clients/c1/settings",
      "DELETE /trainers/me/clients/c1",
      "GET /trainers/me/declaration",
      "POST /trainers/me/declaration",
    ]);
    const body = (i: number) => JSON.parse(String(calls[i].init.body));
    expect(calls[2].init.headers).toMatchObject({ "Idempotency-Key": "k1" });
    expect(body(4)).toEqual({ goal: "g", expectedRevision: 2 });
    expect(body(5)).toEqual({
      items: [{ refId: "r", config: {}, sortOrder: 0 }],
      expectedRevision: 3,
    });
    expect(body(6)).toEqual({ sourceClientId: "c" });
    expect(calls[8].init.headers).toMatchObject({ "Idempotency-Key": "k2" });
    expect(calls[8].init.body).toBeUndefined();
    expect(body(15)).toEqual({ trackCalories: true, expectedRevision: 4 });
    expect(body(18)).toEqual({
      statementVersion: "v1",
      statementTextHash: "h",
    });
  });
});
