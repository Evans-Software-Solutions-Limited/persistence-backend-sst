import { webcrypto } from "node:crypto";
import * as auth from "../auth";
const tokens = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
};
const user = {
  id: "apple-user",
  email: "new@example.test",
  email_confirmed_at: "2026-09-22",
};
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public");
  vi.stubGlobal("crypto", webcrypto);
  fetcher = vi.fn(async (url: string) =>
    Response.json(url.endsWith("/user") ? user : tokens),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function callback() {
  const start = new URL(await auth.oauthUrl("apple"));
  return (
    new URL(start.searchParams.get("redirect_to")!).search + "&code=issued"
  );
}
it.each([429, 503])(
  "recovers exchanged tokens after identity HTTP %s without repeating Apple",
  async (status) => {
    const cb = await callback();
    fetcher
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json({}, { status }));
    const error = await auth.completeCallback(cb, "").catch((e) => e);
    expect(auth.isRetryableAuthError(error)).toBe(true);
    expect(auth.loadSession()).toBeNull();
    await expect(auth.accountSession(user.id)).rejects.toThrow(
      "Please sign in",
    );
    expect(await auth.currentAccount()).toEqual({
      id: user.id,
      email: user.email,
    });
    expect(auth.loadSession()?.accessToken).toBe("access");
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
  },
);
it.each([401, 403])(
  "discards pending identity rejected with HTTP %s",
  async (status) => {
    const cb = await callback();
    fetcher
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json({}, { status }));
    await expect(auth.completeCallback(cb, "")).rejects.toThrow(
      "couldn't complete",
    );
    expect(await auth.currentAccount()).toBeNull();
    expect(
      sessionStorage.getItem("persistence.founding.pending-session"),
    ).toBeNull();
  },
);
it("bounds identity request timeout and recovers", async () => {
  vi.useFakeTimers();
  const cb = await callback();
  fetcher.mockResolvedValueOnce(Response.json(tokens));
  fetcher.mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const result = auth.completeCallback(cb, "").catch((e) => e);
  await vi.advanceTimersByTimeAsync(15000);
  expect(auth.isRetryableAuthError(await result)).toBe(true);
  expect(await auth.currentAccount()).toEqual({
    id: user.id,
    email: user.email,
  });
});
it("does not revive login after logout during identity verification", async () => {
  const cb = await callback();
  let resolve!: (value: Response) => void;
  fetcher.mockResolvedValueOnce(Response.json(tokens));
  fetcher.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = auth.completeCallback(cb, "").catch((e) => e);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  auth.signOut();
  resolve(Response.json(user));
  expect((await result).message).toContain("account changed");
  expect(await auth.currentAccount()).toBeNull();
});
it("does not revive login after logout during code exchange", async () => {
  const cb = await callback();
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const result = auth.completeCallback(cb, "").catch((e) => e);
  auth.signOut();
  resolve(Response.json(tokens));
  expect((await result).message).toContain("account changed");
  expect(await auth.currentAccount()).toBeNull();
});
it("discards expired pending tokens", async () => {
  const cb = await callback();
  fetcher.mockResolvedValueOnce(Response.json({ ...tokens, expires_at: 1 }));
  await expect(auth.completeCallback(cb, "")).rejects.toThrow("expired");
  expect(await auth.currentAccount()).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("recovers password sign-in verification without resending the password", async () => {
  fetcher
    .mockResolvedValueOnce(Response.json(tokens))
    .mockRejectedValueOnce(new TypeError("offline"));
  await expect(auth.signIn(user.email, "test-password")).rejects.toThrow(
    "connection",
  );
  expect(await auth.currentAccount()).toEqual({
    id: user.id,
    email: user.email,
  });
  expect(
    fetcher.mock.calls.filter(([url]) => url.includes("grant_type=password")),
  ).toHaveLength(1);
});
it("retains pending verification after malformed successful identity response", async () => {
  const cb = await callback();
  fetcher
    .mockResolvedValueOnce(Response.json(tokens))
    .mockResolvedValueOnce(new Response("not-json"));
  const error = await auth.completeCallback(cb, "").catch((e) => e);
  expect(auth.isRetryableAuthError(error)).toBe(true);
  expect(await auth.currentAccount()).toEqual({
    id: user.id,
    email: user.email,
  });
});
