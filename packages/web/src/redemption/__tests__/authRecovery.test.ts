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
  const start = new URL(await auth.appleOAuthUrl());
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
    const error = await auth.completeAppleCallback(cb, "").catch((e) => e);
    expect(auth.isRetryableAuthError(error)).toBe(true);
    expect(auth.loadSession()).toBeNull();
    await expect(auth.activeSession()).rejects.toThrow("Please sign in");
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
    await expect(auth.completeAppleCallback(cb, "")).rejects.toThrow(
      "couldn't complete",
    );
    expect(await auth.currentAccount()).toBeNull();
    expect(
      sessionStorage.getItem("persistence.redemption.pending-session"),
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
  const result = auth.completeAppleCallback(cb, "").catch((e) => e);
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
  const result = auth.completeAppleCallback(cb, "").catch((e) => e);
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
  const result = auth.completeAppleCallback(cb, "").catch((e) => e);
  auth.signOut();
  resolve(Response.json(tokens));
  expect((await result).message).toContain("account changed");
  expect(await auth.currentAccount()).toBeNull();
});
it("discards expired pending tokens", async () => {
  const cb = await callback();
  fetcher.mockResolvedValueOnce(Response.json({ ...tokens, expires_at: 1 }));
  await expect(auth.completeAppleCallback(cb, "")).rejects.toThrow("expired");
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
  const error = await auth.completeAppleCallback(cb, "").catch((e) => e);
  expect(auth.isRetryableAuthError(error)).toBe(true);
  expect(await auth.currentAccount()).toEqual({
    id: user.id,
    email: user.email,
  });
});
it("uses S256 PKCE, unique browser proof and no voucher or email in the provider URL", async () => {
  sessionStorage.setItem(
    "persistence.redemption.draft",
    JSON.stringify({
      code: "PRIVATE-CODE",
      accountEmail: "private@example.test",
    }),
  );
  const start = new URL(await auth.appleOAuthUrl());
  const proof = JSON.parse(
    sessionStorage.getItem("persistence.redemption.apple-proof")!,
  );
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(proof.verifier),
  );
  expect(start.searchParams.get("provider")).toBe("apple");
  expect(start.searchParams.get("code_challenge_method")).toBe("s256");
  expect(start.searchParams.get("code_challenge")).toBe(
    Buffer.from(digest).toString("base64url"),
  );
  expect(
    new URL(start.searchParams.get("redirect_to")!).searchParams.get("flow"),
  ).toBe(proof.state);
  expect(start.toString()).not.toContain("PRIVATE-CODE");
  expect(start.toString()).not.toContain("private%40");
  const second = await auth.appleOAuthUrl();
  expect(second).not.toBe(start.toString());
});
it("exchanges the matching proof once and verifies the authoritative Apple relay identity", async () => {
  const cb = await callback();
  const proof = JSON.parse(
    sessionStorage.getItem("persistence.redemption.apple-proof")!,
  );
  const account = await auth.completeAppleCallback(cb, "");
  expect(account).toEqual({ id: user.id, email: user.email });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    auth_code: "issued",
    code_verifier: proof.verifier,
  });
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer access");
  await expect(auth.completeAppleCallback(cb, "")).rejects.toThrow(
    "could not be verified",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(auth.loadSession()).toBeNull();
});
it.each([
  null,
  "invalid",
  JSON.stringify({ verifier: 12, state: "state", createdAt: Date.now() }),
  JSON.stringify({ verifier: "short", state: "state", createdAt: Date.now() }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: 12,
    createdAt: Date.now(),
  }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: "",
    createdAt: Date.now(),
  }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: "wrong",
    createdAt: Date.now(),
  }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: "state",
    createdAt: "invalid",
  }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: "state",
    createdAt: Date.now() + 600000,
  }),
  JSON.stringify({
    verifier: "a".repeat(43),
    state: "state",
    createdAt: Date.now() - 3600001,
  }),
])(
  "rejects missing, corrupt, mismatched or stale proof (%s) without exchange",
  async (proof) => {
    if (proof !== null)
      sessionStorage.setItem("persistence.redemption.apple-proof", proof);
    await expect(
      auth.completeAppleCallback(
        "?flow=state&code=issued",
        "#access_token=attacker&refresh_token=attacker",
      ),
    ).rejects.toThrow("could not be verified");
    expect(fetcher).not.toHaveBeenCalled();
    expect(auth.loadSession()).toBeNull();
  },
);
it.each(["?error=access_denied", "#error=access_denied"])(
  "handles provider cancellation safely (%s)",
  async (error) => {
    const cb = await callback();
    await expect(
      auth.completeAppleCallback(
        error.startsWith("?") ? error : cb,
        error.startsWith("#") ? error : "",
      ),
    ).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem("persistence.redemption.apple-proof"),
    ).toBeNull();
  },
);
it("rejects a missing code and fails closed after a code exchange error", async () => {
  const cb = await callback();
  await expect(
    auth.completeAppleCallback(cb.replace("&code=issued", ""), ""),
  ).rejects.toThrow("could not be verified");
  expect(fetcher).not.toHaveBeenCalled();
  const retry = await callback();
  fetcher.mockRejectedValueOnce(new TypeError("offline"));
  await expect(auth.completeAppleCallback(retry, "")).rejects.toThrow(
    "connection",
  );
  await expect(auth.completeAppleCallback(retry, "")).rejects.toThrow(
    "could not be verified",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("requires configured auth before starting Apple", async () => {
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  await expect(auth.appleOAuthUrl()).rejects.toThrow("unavailable");
});
it("discards an Apple proof when another sign-in method starts", async () => {
  const cb = await callback();
  await auth.signIn(user.email, "password");
  await expect(auth.completeAppleCallback(cb, "")).rejects.toThrow(
    "could not be verified",
  );
});
it("does not return stale current-account identity after sign out", async () => {
  auth.saveSession({
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() / 1000 + 3600,
  });
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = auth.currentAccount();
  await vi.waitFor(() => expect(finish).toBeDefined());
  auth.signOut();
  finish(Response.json(user));
  await expect(pending).rejects.toThrow("account changed");
});
it("does not persist proof after logout during PKCE generation", async () => {
  let finish!: (value: ArrayBuffer) => void;
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => webcrypto.getRandomValues(bytes),
    subtle: {
      digest: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const pending = auth.appleOAuthUrl();
  auth.signOut();
  finish(new ArrayBuffer(32));
  await expect(pending).rejects.toThrow("account changed");
  expect(
    sessionStorage.getItem("persistence.redemption.apple-proof"),
  ).toBeNull();
});
